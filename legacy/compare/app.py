"""Reusable DOCX definitions selected by the original worker.
No standalone legacy server, configuration discovery or startup writes.
"""
import copy
import html
import json
import re
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET
BUSINESS_FORMATS = {'.doc', '.docx', '.pdf', '.xls', '.xlsx', '.png', '.jpg', '.jpeg'}
LEGACY_FORMATS = {'.txt', '.md'}
CONTENT_TYPES = {'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'}
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
XML_NS = 'http://www.w3.org/XML/1998/namespace'
HIGHLIGHT = {'black': '000000', 'blue': '0000FF', 'cyan': '00FFFF', 'green': '00FF00', 'magenta': 'FF00FF', 'red': 'FF0000', 'yellow': 'FFFF00', 'white': 'FFFFFF', 'darkBlue': '000080', 'darkCyan': '008080', 'darkGreen': '008000', 'darkMagenta': '800080', 'darkRed': '800000', 'darkYellow': '808000', 'darkGray': '808080', 'lightGray': 'C0C0C0'}

def q(tag: str) -> str:
    return f'{{{W}}}{tag}'

def wattr(elem: ET.Element | None, name: str, default=None):
    if elem is None:
        return default
    return elem.get(q(name), default)

def safe_name(name: str) -> str:
    name = Path(name or 'document.docx').name.strip() or 'document.docx'
    return re.sub('[<>:"/\\\\|?*\\x00-\\x1f]', '_', name)[:180]

def session_dir(sid: str) -> Path:
    p = DATA_DIR / sid
    p.mkdir(parents=True, exist_ok=True)
    return p

def slot_dir(sid: str, slot: int) -> Path:
    p = session_dir(sid) / f'slot{slot}'
    p.mkdir(parents=True, exist_ok=True)
    return p

def slot_path(sid: str, slot: int) -> Path:
    """Return a slot path without creating directories during read-only requests."""
    return DATA_DIR / sid / f'slot{slot}'

def meta_path(sdir: Path) -> Path:
    return sdir / 'meta.json'

def read_meta(sdir: Path):
    p = meta_path(sdir)
    return json.loads(p.read_text('utf-8')) if p.exists() else None

def write_meta(sdir: Path, meta: dict):
    meta_path(sdir).write_text(json.dumps(meta, ensure_ascii=False, indent=2), 'utf-8')

def _para(text) -> dict:
    return {'type': 'p', 'css': {}, 'bullet': '', 'runs': [{'rpos': 0, 'text': str(text), 'css': {}}]}

def _text_units(text: str) -> list[dict]:
    return [_para(line) for line in (text or '').splitlines() if line.strip()]

def _table_unit(rows) -> dict:
    return {'type': 'table', 'rows': [[{'css': {}, 'paras': [_para(cell)]} for cell in row] for row in rows]}

def _spreadsheet_units(data: bytes, filename: str) -> list[dict]:
    result = extract_spreadsheet_document(data, filename)
    return [_table_unit(sheet.rows) for sheet in result.sheets]

def _pdf_units(path: str) -> list[dict]:
    pages = extract_native_pdf(path)
    needs_ocr = any((page.method == 'needs_ocr' for page in pages))
    images = pdf_to_images(path) if needs_ocr else []
    units: list[dict] = []
    for index, page in enumerate(pages):
        if page.method == 'needs_ocr':
            image = images[index] if index < len(images) else None
            if image is None:
                continue
            result = extract_image_document(image)
            if result.table:
                units.append(_table_unit(result.table))
            else:
                units.extend(_text_units(result.text))
        else:
            units.extend(_text_units(page.text))
            units.extend((_table_unit(table) for table in page.tables))
    return units

def _image_units(path: str) -> list[dict]:
    image = load_image_file(path)
    if image is None:
        raise ValueError('图片加载失败，无法识别。')
    result = extract_image_document(image)
    if result.table:
        return [_table_unit(result.table)]
    return _text_units(result.text)

def _doc_units(path: str) -> list[dict]:
    result = extract_word_document(str(path))
    units = _text_units(result.text)
    units.extend((_table_unit(table) for table in result.tables))
    return units

def parse_uploaded_file(path: Path, filename: str) -> tuple[list[dict], str]:
    """Unified file parsing route: suffix decides the existing parser, and
    every format returns DUIBI units (p/runs, table/rows/cells/paras/runs)."""
    ext = path.suffix.lower()
    if ext == '.docx':
        return (parse_docx(path), 'docx')
    if ext in ('.txt', '.md'):
        text = path.read_text('utf-8', errors='replace')
        return ([_para(line) for line in text.splitlines()], ext[1:])
    if ext == '.doc':
        return (_doc_units(str(path)), 'doc')
    if ext in ('.xls', '.xlsx'):
        return (_spreadsheet_units(path.read_bytes(), filename), ext[1:])
    if ext == '.pdf':
        return (_pdf_units(str(path)), 'pdf')
    return (_image_units(str(path)), 'image')

def on_off(elem: ET.Element | None, default=False):
    if elem is None:
        return default
    v = wattr(elem, 'val')
    if v is None:
        return True
    return str(v).lower() not in {'0', 'false', 'off', 'none'}

def copy_props(dst: dict, src: dict):
    for k, v in src.items():
        if v is not None:
            dst[k] = v
    return dst

def parse_rpr(rpr: ET.Element | None) -> dict:
    if rpr is None:
        return {}
    out = {}
    out['bold'] = on_off(rpr.find('w:b', NS)) if rpr.find('w:b', NS) is not None else None
    out['italic'] = on_off(rpr.find('w:i', NS)) if rpr.find('w:i', NS) is not None else None
    u = rpr.find('w:u', NS)
    if u is not None:
        out['underline'] = wattr(u, 'val', 'single') not in {'none', '0', 'false'}
    strike = rpr.find('w:strike', NS)
    if strike is not None:
        out['strike'] = on_off(strike)
    color = rpr.find('w:color', NS)
    if color is not None:
        v = wattr(color, 'val')
        if v and v not in {'auto', 'none'} and re.fullmatch('[0-9A-Fa-f]{6}', v):
            out['color'] = '#' + v
    sz = rpr.find('w:sz', NS)
    if sz is not None:
        try:
            out['fontSize'] = f"{int(wattr(sz, 'val')) / 2:g}pt"
        except Exception:
            pass
    fonts = rpr.find('w:rFonts', NS)
    if fonts is not None:
        family = wattr(fonts, 'eastAsia') or wattr(fonts, 'ascii') or wattr(fonts, 'hAnsi')
        if family:
            out['fontFamily'] = family
    hl = rpr.find('w:highlight', NS)
    if hl is not None:
        hv = wattr(hl, 'val')
        if hv in HIGHLIGHT:
            out['backgroundColor'] = '#' + HIGHLIGHT[hv]
    shd = rpr.find('w:shd', NS)
    if shd is not None:
        fill = wattr(shd, 'fill')
        if fill and fill not in {'auto', 'nil'} and re.fullmatch('[0-9A-Fa-f]{6}', fill):
            out['backgroundColor'] = '#' + fill
    va = rpr.find('w:vertAlign', NS)
    if va is not None:
        vv = wattr(va, 'val')
        if vv in {'superscript', 'subscript'}:
            out['verticalAlign'] = 'super' if vv == 'superscript' else 'sub'
            out['fontSize'] = '0.8em'
    return {k: v for k, v in out.items() if v is not None}

def parse_ppr(ppr: ET.Element | None) -> dict:
    if ppr is None:
        return {}
    out = {}
    jc = ppr.find('w:jc', NS)
    if jc is not None:
        v = wattr(jc, 'val')
        out['textAlign'] = {'center': 'center', 'right': 'right', 'both': 'justify', 'distribute': 'justify', 'left': 'left'}.get(v, v)
    shd = ppr.find('w:shd', NS)
    if shd is not None:
        fill = wattr(shd, 'fill')
        if fill and fill not in {'auto', 'nil'} and re.fullmatch('[0-9A-Fa-f]{6}', fill):
            out['backgroundColor'] = '#' + fill
    spacing = ppr.find('w:spacing', NS)
    if spacing is not None:
        for attr, css in (('before', 'marginTop'), ('after', 'marginBottom')):
            v = wattr(spacing, attr)
            if v is not None:
                try:
                    out[css] = f'{int(v) / 20:g}pt'
                except Exception:
                    pass
        line = wattr(spacing, 'line')
        rule = wattr(spacing, 'lineRule', 'auto')
        if line is not None:
            try:
                if rule == 'auto':
                    out['lineHeight'] = f'{int(line) / 240:g}'
                else:
                    out['lineHeight'] = f'{int(line) / 20:g}pt'
            except Exception:
                pass
    ind = ppr.find('w:ind', NS)
    if ind is not None:
        first = wattr(ind, 'firstLine')
        hanging = wattr(ind, 'hanging')
        left = wattr(ind, 'left') or wattr(ind, 'start')
        if first:
            try:
                out['textIndent'] = f'{int(first) / 20:g}pt'
            except Exception:
                pass
        elif hanging:
            try:
                out['textIndent'] = f'{-int(hanging) / 20:g}pt'
            except Exception:
                pass
        if left:
            try:
                out['paddingLeft'] = f'{int(left) / 20:g}pt'
            except Exception:
                pass
    borders = ppr.find('w:pBdr', NS)
    if borders is not None:
        for edge, css in (('bottom', 'borderBottom'), ('top', 'borderTop'), ('left', 'borderLeft'), ('right', 'borderRight')):
            b = borders.find(f'w:{edge}', NS)
            if b is not None and wattr(b, 'val') not in {None, 'nil', 'none'}:
                color = wattr(b, 'color', '999999')
                try:
                    width = max(1, int(wattr(b, 'sz', '8')) / 8)
                except Exception:
                    width = 1
                out[css] = f"{width:g}px solid #{(color if re.fullmatch('[0-9A-Fa-f]{6}', color or '') else '999999')}"
    return out

def parse_style_sheet(z: zipfile.ZipFile):
    styles = {}
    defaults = {'r': {}, 'p': {}}
    if 'word/styles.xml' not in z.namelist():
        return (styles, defaults)
    root = ET.fromstring(z.read('word/styles.xml'))
    docdef = root.find('w:docDefaults', NS)
    if docdef is not None:
        rr = docdef.find('w:rPrDefault/w:rPr', NS)
        pp = docdef.find('w:pPrDefault/w:pPr', NS)
        defaults['r'] = parse_rpr(rr)
        defaults['p'] = parse_ppr(pp)
    for st in root.findall('w:style', NS):
        sid = wattr(st, 'styleId')
        if not sid:
            continue
        styles[sid] = {'type': wattr(st, 'type'), 'basedOn': wattr(st.find('w:basedOn', NS), 'val'), 'r': parse_rpr(st.find('w:rPr', NS)), 'p': parse_ppr(st.find('w:pPr', NS)), 'name': wattr(st.find('w:name', NS), 'val', sid)}
    return (styles, defaults)

def style_chain(styles: dict, sid: str | None, kind: str) -> dict:
    out = {}
    seen = set()
    chain = []
    cur = sid
    while cur and cur not in seen and (cur in styles):
        seen.add(cur)
        chain.append(cur)
        cur = styles[cur].get('basedOn')
    for x in reversed(chain):
        copy_props(out, styles[x].get(kind, {}))
    return out

def run_text(run: ET.Element) -> str:
    parts = []
    for node in list(run):
        if node.tag == q('t'):
            parts.append(node.text or '')
        elif node.tag == q('tab'):
            parts.append('\t')
        elif node.tag in (q('br'), q('cr')):
            parts.append('\n')
    return ''.join(parts)

def paragraph_model(p: ET.Element, styles: dict, defaults: dict) -> dict:
    ppr = p.find('w:pPr', NS)
    ps = ppr.find('w:pStyle', NS) if ppr is not None else None
    sid = wattr(ps, 'val')
    pcss = dict(defaults['p'])
    copy_props(pcss, style_chain(styles, sid, 'p'))
    copy_props(pcss, parse_ppr(ppr))
    base_rcss = dict(defaults['r'])
    copy_props(base_rcss, style_chain(styles, sid, 'r'))
    runs = []
    all_runs = p.findall('.//w:r', NS)
    for rpos, r in enumerate(all_runs):
        text = run_text(r)
        if text == '' and r.find('.//w:drawing', NS) is not None:
            continue
        rpr = r.find('w:rPr', NS)
        rs = rpr.find('w:rStyle', NS) if rpr is not None else None
        rsid = wattr(rs, 'val')
        css = dict(base_rcss)
        copy_props(css, style_chain(styles, rsid, 'r'))
        copy_props(css, parse_rpr(rpr))
        if text != '' or not runs:
            runs.append({'rpos': rpos, 'text': text, 'css': css})
    if not runs:
        runs = [{'rpos': -1, 'text': '', 'css': base_rcss}]
    bullet = '• ' if sid == 'ListBullet' or (styles.get(sid, {}).get('name') or '').lower() == 'list bullet' else ''
    return {'type': 'p', 'styleId': sid, 'css': pcss, 'bullet': bullet, 'runs': runs}

def cell_css(tc: ET.Element) -> dict:
    out = {}
    tcpr = tc.find('w:tcPr', NS)
    if tcpr is None:
        return out
    shd = tcpr.find('w:shd', NS)
    if shd is not None:
        fill = wattr(shd, 'fill')
        if fill and fill not in {'auto', 'nil'} and re.fullmatch('[0-9A-Fa-f]{6}', fill):
            out['backgroundColor'] = '#' + fill
    va = tcpr.find('w:vAlign', NS)
    if va is not None:
        v = wattr(va, 'val')
        out['verticalAlign'] = {'center': 'middle', 'bottom': 'bottom', 'top': 'top'}.get(v, 'top')
    return out

def table_model(tbl: ET.Element, styles: dict, defaults: dict) -> dict:
    rows = []
    for tr in tbl.findall('w:tr', NS):
        row = []
        for tc in tr.findall('w:tc', NS):
            paras = [paragraph_model(p, styles, defaults) for p in tc.findall('w:p', NS)]
            row.append({'css': cell_css(tc), 'paras': paras})
        rows.append(row)
    return {'type': 'table', 'rows': rows}

def parse_docx(path: Path) -> list[dict]:
    with zipfile.ZipFile(path, 'r') as z:
        styles, defaults = parse_style_sheet(z)
        root = ET.fromstring(z.read('word/document.xml'))
    body = root.find('w:body', NS)
    units = []
    if body is None:
        return units
    for child in list(body):
        if child.tag == q('p'):
            units.append(paragraph_model(child, styles, defaults))
        elif child.tag == q('tbl'):
            units.append(table_model(child, styles, defaults))
    return units

def clear_text_tokens(run: ET.Element):
    for child in list(run):
        if child.tag in {q('t'), q('tab'), q('br'), q('cr')}:
            run.remove(child)

def append_text_tokens(run: ET.Element, text: str):
    chunks = re.split('([\\t\\n])', text)
    for chunk in chunks:
        if chunk == '\t':
            ET.SubElement(run, q('tab'))
        elif chunk == '\n':
            ET.SubElement(run, q('br'))
        elif chunk != '':
            t = ET.SubElement(run, q('t'))
            t.text = chunk
            if chunk[:1].isspace() or chunk[-1:].isspace():
                t.set(f'{{{XML_NS}}}space', 'preserve')

def set_run_text(run: ET.Element, text: str):
    clear_text_tokens(run)
    append_text_tokens(run, text)

def save_paragraph(p: ET.Element, model: dict):
    all_runs = p.findall('.//w:r', NS)
    for rm in model.get('runs', []):
        try:
            rpos = int(rm.get('rpos', -1))
        except Exception:
            rpos = -1
        text = str(rm.get('text', ''))
        if 0 <= rpos < len(all_runs):
            set_run_text(all_runs[rpos], text)
        elif rpos == -1 and text:
            r = ET.SubElement(p, q('r'))
            append_text_tokens(r, text)

def save_table(tbl: ET.Element, model: dict):
    trs = tbl.findall('w:tr', NS)
    for ri, rowm in enumerate(model.get('rows', [])):
        if ri >= len(trs):
            break
        tcs = trs[ri].findall('w:tc', NS)
        for ci, cellm in enumerate(rowm):
            if ci >= len(tcs):
                break
            ps = tcs[ci].findall('w:p', NS)
            for pi, pm in enumerate(cellm.get('paras', [])):
                if pi >= len(ps):
                    break
                save_paragraph(ps[pi], pm)

def save_docx_from_units(original: Path, output: Path, units: list[dict]):
    with zipfile.ZipFile(original, 'r') as zin:
        root = ET.fromstring(zin.read('word/document.xml'))
        body = root.find('w:body', NS)
        blocks = [] if body is None else [c for c in list(body) if c.tag in {q('p'), q('tbl')}]
        for i, model in enumerate(units):
            if i >= len(blocks):
                break
            block = blocks[i]
            if model.get('type') == 'p' and block.tag == q('p'):
                save_paragraph(block, model)
            elif model.get('type') == 'table' and block.tag == q('tbl'):
                save_table(block, model)
        new_xml = ET.tostring(root, encoding='utf-8', xml_declaration=True)
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = new_xml if item.filename == 'word/document.xml' else zin.read(item.filename)
                zout.writestr(item, data)
INDEX_HTML = '\n<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>原订单 ↔ 供应商送货单核对 V5</title>\n<style>\n*{box-sizing:border-box}body{margin:0;background:#eef1f4;color:#1f2937;font-family:Arial,"Microsoft YaHei","Noto Sans CJK SC",sans-serif}header{height:118px;background:#fff;border-bottom:1px solid #d8dee6;padding:12px 18px 10px;display:flex;flex-direction:column;gap:9px}.headrow{display:flex;align-items:center;justify-content:space-between;gap:16px}h1{font-size:19px;margin:0}.support{font-size:12px;color:#64748b;margin-top:5px}.quick-guide{display:flex;align-items:center;gap:10px;padding:6px 12px;border:1px solid #99f6e4;border-radius:9px;background:#f0fdfa;color:#334155;font-size:12px;line-height:1.4}.guide-title{font-weight:700;color:#0f766e;white-space:nowrap}.guide-step{padding-left:10px;border-left:1px solid #99f6e4;white-space:nowrap}.guide-step b{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-right:4px;border-radius:50%;background:#0f766e;color:#fff;font-size:11px}.viewbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.modehint{font-size:12px;color:#64748b}.businessbtn{background:#0f766e;color:#fff;border:1px solid #0f766e;border-radius:7px;padding:6px 14px;font-size:12px;cursor:pointer}.businessbtn:hover{border-color:#115e59}main{display:flex;align-items:stretch;gap:0;padding:10px;height:calc(100vh - 118px)}.col{background:#fff;border:1px solid #d8dee6;border-radius:10px;flex:1 1 0;min-width:25%;max-width:75%;display:flex;flex-direction:column;overflow:hidden}.splitter{flex:0 0 12px;cursor:col-resize;background:#cbd5e1;border-radius:3px;margin:0 3px;user-select:none}.toolbar{padding:8px;border-bottom:1px solid #e5e7eb;display:flex;gap:5px;align-items:center;min-height:68px;flex-wrap:wrap}.title{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1 1 110px}.toolbar button,.upload-label{border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:6px 8px;font-size:12px;cursor:pointer}.primary{background:#111827!important;color:#fff!important;border-color:#111827!important}.toolbar button:disabled{opacity:.45;cursor:not-allowed}input[type=file]{display:none}.zoomgroup{display:flex;align-items:center;gap:2px}.zoomgroup button{width:28px;padding:4px 0}.zoomlabel{font-size:11px;color:#64748b;min-width:38px;text-align:center}.status{font-size:11px;color:#64748b;min-height:14px;flex-basis:100%}.doc{flex:1;overflow:auto;padding:14px;background:#f8fafc}.paper{background:#fff;max-width:900px;margin:0 auto;padding:22px 26px;box-shadow:0 1px 4px #0f172a14;border:1px solid #e2e8f0;min-height:300px}.p{margin:4px 0;line-height:1.6;white-space:pre-wrap}.run{outline:none}.bullet{margin-right:6px}.paper table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13px}.paper td,.paper th{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;vertical-align:top}.empty{color:#94a3b8;text-align:center;margin-top:80px;font-size:13px}mark.diff-mark{padding:0 1px;border-radius:2px}mark.diff-left{background:#fecaca;color:#991b1b}mark.diff-right{background:#bbf7d0;color:#14532d}.p.diff-only-left{background:#fef2f2}.p.diff-only-right{background:#f0fdf4}.p.diff-changed-left{background:#fff7ed}.p.diff-changed-right{background:#f0fdfa}.compare-overlay{position:fixed;inset:0;background:#0f172a66;display:none;align-items:center;justify-content:center;z-index:50}.compare-overlay.open{display:flex}.compare-panel{background:#fff;border-radius:12px;width:min(1100px,94vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden}.compare-head{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid #e5e7eb}.compare-head h2{margin:0;font-size:16px}.closebtn{border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:5px 12px;cursor:pointer;font-size:12px}.compare-body{overflow:auto;padding:14px 18px}.compare-note{font-size:12px;color:#475569;margin:4px 0;line-height:1.6}.partybox{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin:8px 0;font-size:13px;line-height:1.7}.partybox .lbl{font-weight:700;color:#0f766e}.warning{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:8px;padding:8px 12px;margin:6px 0;font-size:12px}.summary{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.summary span{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:3px 8px;font-size:12px}.compare-table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}.compare-table th,.compare-table td{border:1px solid #e2e8f0;padding:5px 7px;text-align:left}.compare-table th{background:#f1f5f9;position:sticky;top:0}.result-ok{background:#f0fdf4}.result-warn{background:#fffbeb}.result-bad{background:#fef2f2}@media(max-width:900px){header{height:178px}.headrow{align-items:flex-start;flex-direction:column;gap:8px}.quick-guide{width:100%;display:grid;grid-template-columns:auto 1fr 1fr}.guide-title{grid-row:1/3}.guide-step{white-space:normal}main{height:calc(100vh - 178px)}}\n</style>\n</head><body><header><div class="headrow"><div class="intro"><h1>原订单 ↔ 供应商送货单核对</h1><div class="support">支持 DOC / DOCX / PDF / XLS / XLSX / PNG / JPG / JPEG（TXT/MD 兼容）</div></div><div class="quick-guide"><span class="guide-title">操作说明</span><span class="guide-step"><b>1</b>第1列上传原订单</span><span class="guide-step"><b>2</b>第2列上传供应商送货单</span><span class="guide-step"><b>3</b>点击“订单 / 送货单核对”</span><span class="guide-step"><b>4</b>正文可直接修改 → 保存 → 核对</span></div></div><div class="viewbar"><span class="modehint" id="modehint">普通文字 Diff 固定比较：原订单 ↔ 供应商送货单；业务核对固定比较第1列与第2列</span><button class="businessbtn" id="business-compare">订单 / 送货单核对</button></div></header><main id="grid"></main><div class="compare-overlay" id="compare-overlay"><section class="compare-panel"><div class="compare-head"><h2>订单与送货单核对结果</h2><button class="closebtn" id="compare-close">关闭</button></div><div class="compare-body" id="compare-body"><div class="compare-note">第1列作为原订单，第2列作为供应商送货单。</div></div></section></div>\n<script>\nconst slots=[1,2],grid=document.getElementById(\'grid\');\nconst labels={1:\'原订单\',2:\'供应商送货单\'};\nconst acceptAll=\'.doc,.docx,.pdf,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.md\';\nconst emptyText=\'上传一个文件<br>DOC / DOCX / PDF / XLS / XLSX / PNG / JPG / JPEG\';\nconst downloadKinds=[\'docx\',\'txt\',\'md\'];\nconst viewKinds=[\'image\',\'pdf\'];\nconst kinds={};\nconst zooms={1:100,2:100};\nfunction tpl(n){return `<section class="col" id="col-${n}" data-slot="${n}"><div class="toolbar"><div class="title" id="title-${n}">${labels[n]}：未上传</div><label class="upload-label">上传/替换<input type="file" id="file-${n}" accept="${acceptAll}"></label><button class="primary" id="save-${n}" disabled>保存</button><button id="download-${n}" disabled>下载</button><button id="original-${n}" disabled title="查看原件图片/PDF，人工复核">查看原件</button><div class="zoomgroup"><button type="button" id="zoomout-${n}" title="缩小预览">−</button><span class="zoomlabel" id="zoomlabel-${n}">100%</span><button type="button" id="zoomin-${n}" title="放大预览">＋</button></div><button id="clear-${n}" disabled>清空</button><div class="status" id="status-${n}"></div></div><div class="doc" id="doc-${n}"><div class="empty">${emptyText}</div></div></section>`}\ngrid.innerHTML=tpl(1)+\'<div class="splitter" id="splitter"></div>\'+tpl(2);\nconst col1=document.getElementById(\'col-1\'),col2=document.getElementById(\'col-2\'),splitter=document.getElementById(\'splitter\');\nlet ratio=parseFloat(localStorage.getItem(\'duibi_ratio\'))||50;\nfunction applyRatio(){let p=Math.max(25,Math.min(75,ratio));col1.style.flexGrow=String(p);col2.style.flexGrow=String(100-p)}\napplyRatio();\nlet dragging=false;\nsplitter.addEventListener(\'mousedown\',e=>{dragging=true;e.preventDefault();document.body.style.cursor=\'col-resize\';document.body.style.userSelect=\'none\'});\ndocument.addEventListener(\'mousemove\',e=>{if(!dragging)return;let r=grid.getBoundingClientRect();ratio=Math.max(25,Math.min(75,((e.clientX-r.left)/r.width)*100));applyRatio()});\ndocument.addEventListener(\'mouseup\',()=>{if(dragging){dragging=false;document.body.style.cursor=\'\';document.body.style.userSelect=\'\';localStorage.setItem(\'duibi_ratio\',String(Math.round(ratio)))}});\nfunction status(n,s,c=\'\'){let e=document.getElementById(`status-${n}`);e.textContent=s;e.className=\'status \'+c}\nasync function apiJson(url,options={}){let response;try{response=await fetch(url,options)}catch(_){throw new Error(\'连接不到程序后台，请确认 python app.py 正在运行，然后刷新页面\')}let data;try{data=await response.json()}catch(_){throw new Error(`程序后台响应异常（${response.status}）`)}if(!response.ok)throw new Error(data.error||`操作失败（${response.status}）`);return data}\nfunction buttons(n,on){[\'save\',\'download\',\'clear\'].forEach(k=>document.getElementById(`${k}-${n}`).disabled=!on)}\nfunction applyCss(el,css){if(!css)return;for(const [k,v] of Object.entries(css)){if(v===null||v===undefined)continue;if(k===\'bold\')el.style.fontWeight=v?\'700\':\'400\';else if(k===\'italic\')el.style.fontStyle=v?\'italic\':\'normal\';else if(k===\'underline\'){if(v)el.style.textDecoration=(el.style.textDecoration+\' underline\').trim()}else if(k===\'strike\'){if(v)el.style.textDecoration=(el.style.textDecoration+\' line-through\').trim()}else el.style[k]=v}}\nfunction makeP(pm){let p=document.createElement(\'div\');p.className=\'p\';p.dataset.type=\'p\';applyCss(p,pm.css||{});if(pm.bullet){let b=document.createElement(\'span\');b.className=\'bullet\';b.textContent=pm.bullet;p.appendChild(b)};(pm.runs||[]).forEach(r=>{let s=document.createElement(\'span\');s.className=\'run\';s.contentEditable=\'true\';s.dataset.rpos=String(r.rpos);s.textContent=r.text||\'\';applyCss(s,r.css||{});p.appendChild(s)});return p}\nfunction makeTable(u){let t=document.createElement(\'table\');t.dataset.type=\'table\';(u.rows||[]).forEach(row=>{let tr=document.createElement(\'tr\');row.forEach(cell=>{let td=document.createElement(\'td\');applyCss(td,cell.css||{});(cell.paras||[]).forEach(pm=>td.appendChild(makeP(pm)));tr.appendChild(td)});t.appendChild(tr)});return t}\nfunction applyZoom(n){let paper=document.querySelector(`#doc-${n} .paper`),label=document.getElementById(`zoomlabel-${n}`);if(label)label.textContent=`${zooms[n]}%`;if(!paper)return;let z=zooms[n]/100;paper.style.zoom=String(z);paper.style.width=`${100/z}%`}\nfunction setZoom(n,value){zooms[n]=Math.max(70,Math.min(150,value));applyZoom(n)}\nfunction render(n,units){let box=document.getElementById(`doc-${n}`);box.innerHTML=\'\';let paper=document.createElement(\'div\');paper.className=\'paper\';units.forEach(u=>{if(u.type===\'p\')paper.appendChild(makeP(u));else if(u.type===\'table\')paper.appendChild(makeTable(u))});box.appendChild(paper);applyZoom(n)}\nfunction collectP(p){return {type:\'p\',runs:[...p.querySelectorAll(\':scope > .run\')].map(s=>({rpos:Number(s.dataset.rpos),text:s.innerText.replace(/\\r/g,\'\')}))}}\nfunction collect(n){let paper=document.querySelector(`#doc-${n} .paper`);if(!paper)return[];let out=[];[...paper.children].forEach(el=>{if(el.dataset.type===\'p\')out.push(collectP(el));else if(el.dataset.type===\'table\'){let rows=[...el.querySelectorAll(\':scope > tbody > tr, :scope > tr\')].map(tr=>[...tr.children].map(td=>({paras:[...td.querySelectorAll(\':scope > .p\')].map(collectP)})));out.push({type:\'table\',rows})}});return out}\nfunction clearDiff(){document.querySelectorAll(\'mark.diff-mark\').forEach(m=>{let parent=m.parentNode;m.replaceWith(document.createTextNode(m.textContent||\'\'));if(parent)parent.normalize()});document.querySelectorAll(\'.p.diff-only-left,.p.diff-only-right,.p.diff-changed-left,.p.diff-changed-right\').forEach(p=>p.classList.remove(\'diff-only-left\',\'diff-only-right\',\'diff-changed-left\',\'diff-changed-right\'))}\nfunction paragraphText(p){return [...p.querySelectorAll(\':scope > .run\')].map(r=>r.textContent||\'\').join(\'\')}\nfunction paragraphKey(p){return paragraphText(p).replace(/\\s+/g,\' \').trim()}\nfunction lcsMatches(a,b,key){let n=a.length,m=b.length;if(!n||!m||n*m>2000000)return[];let ak=a.map(key),bk=b.map(key),dp=Array.from({length:n+1},()=>new Uint16Array(m+1));for(let i=n-1;i>=0;i--){for(let j=m-1;j>=0;j--){dp[i][j]=ak[i]===bk[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1])}}let out=[],i=0,j=0;while(i<n&&j<m){if(ak[i]===bk[j]){out.push([i,j]);i++;j++}else if(dp[i+1][j]>=dp[i][j+1])i++;else j++}return out}\nfunction textTokens(text){if(!text)return[];if(window.Intl&&Intl.Segmenter){return [...new Intl.Segmenter(\'zh-CN\',{granularity:\'word\'}).segment(text)].map(x=>({v:x.segment,start:x.index,end:x.index+x.segment.length}))}let out=[],re=/\\s+|[A-Za-z0-9_]+|[\\u3400-\\u9fff]|[^\\s]/gu,m;while((m=re.exec(text)))out.push({v:m[0],start:m.index,end:m.index+m[0].length});return out}\nfunction mergeRanges(ranges){let out=[];for(const r of ranges){if(r[0]>=r[1])continue;let last=out[out.length-1];if(last&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else out.push([r[0],r[1]])}return out}\nfunction textDiffRanges(left,right){let a=textTokens(left),b=textTokens(right);if(a.length*b.length>250000)return{left:left?[[0,left.length]]:[],right:right?[[0,right.length]]:[]};let matches=lcsMatches(a,b,x=>x.v),lr=[],rr=[],ai=0,bi=0;for(const [ma,mb] of matches){if(ai<ma)lr.push([a[ai].start,a[ma-1].end]);if(bi<mb)rr.push([b[bi].start,b[mb-1].end]);ai=ma+1;bi=mb+1}if(ai<a.length)lr.push([a[ai].start,a[a.length-1].end]);if(bi<b.length)rr.push([b[bi].start,b[b.length-1].end]);return{left:mergeRanges(lr),right:mergeRanges(rr)}}\nfunction markRanges(p,ranges,cls){let offset=0;[...p.querySelectorAll(\':scope > .run\')].forEach(run=>{let text=run.textContent||\'\',local=ranges.map(([s,e])=>[Math.max(0,s-offset),Math.min(text.length,e-offset)]).filter(([s,e])=>s<e);if(local.length){let frag=document.createDocumentFragment(),pos=0;for(const [s,e] of local){if(s>pos)frag.appendChild(document.createTextNode(text.slice(pos,s)));let mark=document.createElement(\'mark\');mark.className=`diff-mark ${cls}`;mark.textContent=text.slice(s,e);frag.appendChild(mark);pos=e}if(pos<text.length)frag.appendChild(document.createTextNode(text.slice(pos)));run.replaceChildren(frag)}offset+=text.length})}\nfunction markChanged(leftP,rightP){let ranges=textDiffRanges(paragraphText(leftP),paragraphText(rightP));leftP.classList.add(\'diff-changed-left\');rightP.classList.add(\'diff-changed-right\');markRanges(leftP,ranges.left,\'diff-left\');markRanges(rightP,ranges.right,\'diff-right\')}\nfunction applyPairDiff(visible){clearDiff();if(!visible||visible.length!==2)return;let leftPaper=document.querySelector(`#doc-${visible[0]} .paper`),rightPaper=document.querySelector(`#doc-${visible[1]} .paper`);if(!leftPaper||!rightPaper)return;let left=[...leftPaper.querySelectorAll(\'.p\')],right=[...rightPaper.querySelectorAll(\'.p\')],matches=lcsMatches(left,right,paragraphKey),li=0,ri=0;function markBlock(le,re){let count=Math.min(le-li,re-ri);for(let k=0;k<count;k++)markChanged(left[li+k],right[ri+k]);for(let i=li+count;i<le;i++)left[i].classList.add(\'diff-only-left\');for(let i=ri+count;i<re;i++)right[i].classList.add(\'diff-only-right\')}for(const [lm,rm] of matches){markBlock(lm,rm);li=lm+1;ri=rm+1}markBlock(left.length,right.length)}\nfunction scheduleDiff(){requestAnimationFrame(()=>applyPairDiff([1,2]))}\nfunction escapeHtml(value){return String(value??\'\').replace(/[&<>"\']/g,ch=>({\'&\':\'&amp;\',\'<\':\'&lt;\',\'>\':\'&gt;\',\'"\':\'&quot;\',"\'":\'&#39;\'}[ch]))}\nfunction renderBusinessResult(data){let body=document.getElementById(\'compare-body\'),counts=data.counts||{},order=data.order_meta||{},delivery=data.delivery_meta||{};let warnings=(data.warnings||[]).map(x=>`<div class="warning">${escapeHtml(x)}</div>`).join(\'\');let cands=[...(data.order_party_candidates||[]),...(data.delivery_party_candidates||[])],uniqueC=[...new Set(cands)];let party=`<div class="partybox"><span class="lbl">原订单</span>\u3000客户 / 采购方：${escapeHtml(order.customer||\'未识别\')}\u3000供应商：${escapeHtml(order.supplier||\'未识别\')}\u3000订单号：${escapeHtml(order.order_no||\'未识别\')}</div><div class="partybox"><span class="lbl">供应商送货单</span>\u3000供应商 / 送货方：${escapeHtml(delivery.supplier||\'未识别\')}\u3000客户 / 收货方：${escapeHtml(delivery.customer||\'未识别\')}\u3000关联订单号：${escapeHtml(delivery.order_no||\'未识别\')}\u3000送货单号：${escapeHtml(delivery.delivery_no||\'未识别\')}\u3000送货日期：${escapeHtml(delivery.delivery_date||\'未识别\')}</div>`;if(data.party_review_required&&uniqueC.length){party+=`<div class="warning">需要人工确认的公司主体：${uniqueC.map(escapeHtml).join(\'、\')}</div>`}let summary=`<div class="compare-note">第1列作为原订单，第2列作为供应商送货单。成功提取订单明细 ${escapeHtml(data.order_record_count||0)} 行、送货明细 ${escapeHtml(data.delivery_record_count||0)} 行；待人工复核 ${escapeHtml((data.order_review_count||0)+(data.delivery_review_count||0))} 行。</div><div class="summary"><span>数量一致：${escapeHtml(counts[\'数量一致\']||0)}</span><span>部分交付：${escapeHtml(counts[\'部分交付\']||0)}</span><span>超量送货：${escapeHtml(counts[\'超量送货\']||0)}</span><span>本次未送：${escapeHtml(counts[\'本次未送\']||0)}</span><span>订单外多送：${escapeHtml(counts[\'订单外多送\']||0)}</span><span>订单号不一致：${escapeHtml(counts[\'订单号不一致\']||0)}</span><span>单位不一致：${escapeHtml(counts[\'单位不一致\']||0)}</span><span>需要人工复核：${escapeHtml(counts[\'需要人工复核\']||0)}</span></div>`;let rows=(data.rows||[]).map(row=>{let issues=row.issues||[];let cls=issues.length===1&&issues[0]===\'数量一致\'?\'result-ok\':issues.every(x=>x===\'部分交付\'||x===\'本次未送\'||x===\'数量一致\'||x===\'需要人工复核\')?\'result-warn\':\'result-bad\';let orderName=row.order_product_name||\'\',deliveryName=row.delivery_product_name||\'\',productName=orderName===deliveryName?escapeHtml(orderName||\'未识别\'):`<div>订单：${escapeHtml(orderName||\'未识别\')}</div><div>送货：${escapeHtml(deliveryName||\'未识别\')}</div>`;let review=row.review_reason?`<div style="font-size:11px;font-weight:400;margin-top:4px">${escapeHtml(row.review_reason)}</div>`:\'\';return `<tr><td>${escapeHtml(row.part_no)}</td><td>${productName}</td><td>${escapeHtml(row.order_no)}</td><td>${escapeHtml(row.delivery_order_no)}</td><td>${escapeHtml(row.ordered_quantity)} ${escapeHtml(row.order_unit)}</td><td>${escapeHtml(row.delivered_quantity)} ${escapeHtml(row.delivery_unit)}</td><td>${escapeHtml(row.remaining)}</td><td class="${cls}">${escapeHtml(row.status)}${review}</td></tr>`}).join(\'\');let table=`<table class="compare-table"><thead><tr><th>PN / 零件号</th><th>产品名</th><th>订单号</th><th>送货单关联订单号</th><th>订单数量</th><th>本次送货数量</th><th>理论剩余</th><th>结果</th></tr></thead><tbody>${rows}</tbody></table>`;body.innerHTML=party+summary+warnings+table}\nasync function runBusinessCompare(){let overlay=document.getElementById(\'compare-overlay\'),body=document.getElementById(\'compare-body\');overlay.classList.add(\'open\');body.innerHTML=\'<div class="compare-note">正在提取订单号、PN/零件号、产品名、数量和单位并进行核对……</div>\';try{let data=await apiJson(\'/api/business-compare\',{method:\'POST\',headers:{\'Content-Type\':\'application/json\'},body:JSON.stringify({order_units:collect(1),delivery_units:collect(2)})});renderBusinessResult(data)}catch(error){body.innerHTML=`<div class="warning">${escapeHtml(error.message||error)}</div>`}}\ndocument.getElementById(\'business-compare\').onclick=runBusinessCompare;\ndocument.getElementById(\'compare-close\').onclick=()=>document.getElementById(\'compare-overlay\').classList.remove(\'open\');\ndocument.getElementById(\'compare-overlay\').onclick=e=>{if(e.target.id===\'compare-overlay\')e.currentTarget.classList.remove(\'open\')};\nasync function refresh(n){let box=document.getElementById(`doc-${n}`),scroll=box.scrollTop;try{let d=await apiJson(`/api/slot/${n}`);kinds[n]=d.kind||\'\';let vb=document.getElementById(`original-${n}`);if(!d.exists){document.getElementById(`title-${n}`).textContent=`${labels[n]}：未上传`;box.innerHTML=`<div class="empty">${emptyText}</div>`;buttons(n,false);if(vb)vb.disabled=true;scheduleDiff();return}document.getElementById(`title-${n}`).textContent=`${labels[n]}：${d.name}`;render(n,d.units);buttons(n,true);document.getElementById(`download-${n}`).disabled=!downloadKinds.includes(d.kind);if(vb)vb.disabled=!viewKinds.includes(d.kind);status(n,d.saved?\'已有保存版本\':\'已载入\',\'ok\');box.scrollTop=scroll;scheduleDiff()}catch(error){buttons(n,false);let vb=document.getElementById(`original-${n}`);if(vb)vb.disabled=true;status(n,error.message||\'连接失败\',\'err\')}}\nslots.forEach(n=>{document.getElementById(`original-${n}`).onclick=()=>location.href=`/original/${n}`;document.getElementById(`file-${n}`).onchange=async e=>{let f=e.target.files[0];if(!f)return;status(n,\'上传中...\');let fd=new FormData();fd.append(\'file\',f);try{await apiJson(`/api/upload/${n}`,{method:\'POST\',body:fd});await refresh(n)}catch(error){status(n,error.message||\'上传失败\',\'err\')}finally{e.target.value=\'\'}};document.getElementById(`save-${n}`).onclick=async()=>{status(n,\'保存中...\');try{await apiJson(`/api/save/${n}`,{method:\'POST\',headers:{\'Content-Type\':\'application/json\'},body:JSON.stringify({units:collect(n)})});status(n,downloadKinds.includes(kinds[n])?\'保存成功，可下载修改版\':\'保存成功（仅当前会话，无原格式下载）\',\'ok\')}catch(error){status(n,error.message||\'保存失败\',\'err\')}};document.getElementById(`download-${n}`).onclick=()=>location.href=`/download/${n}`;document.getElementById(`clear-${n}`).onclick=async()=>{try{await apiJson(`/api/slot/${n}`,{method:\'DELETE\'});status(n,\'\');await refresh(n)}catch(error){status(n,error.message||\'清空失败\',\'err\')}};document.getElementById(`zoomout-${n}`).onclick=()=>setZoom(n,zooms[n]-10);document.getElementById(`zoomin-${n}`).onclick=()=>setZoom(n,zooms[n]+10)});\ngrid.addEventListener(\'focusout\',e=>{if(e.target.classList&&e.target.classList.contains(\'run\'))scheduleDiff()});\nslots.forEach(refresh);scheduleDiff();\n</script></body></html>\n'
