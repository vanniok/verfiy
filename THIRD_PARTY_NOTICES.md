# 第三方来源、许可证与授权范围

核对日期：2026-11-04。依据为当前源码、原工程本地依赖元数据、上游随附许可及样例生成记录。这里列的是观察到的版本，不是已验证的干净安装锁，也不是全面合规通过结论。

## 自有代码与复制内容

根目录LICENSE采用MIT，适用于朱威有权授权的自有代码及文档；不授予对第三方代码、模板、依赖、模型或商标的额外权利。已有第三方权利声明优先按其原许可证保留，不能把依赖许可证统一改成MIT。

`legacy/ocr`、`legacy/compare`、`static/legacy-diff.js`来源于作者提供的旧OCR／DUIBI工程导出及本地导入记录。授权依据是作者对自有代码的授权表示；本地导出记录不能单独证明版权。当前未识别出另行嵌入的第三方JS库或具体侵权证据。如这些文件含他人贡献，应在发布前补充其原许可或取得授权，不得仅依据本文件替代。

| 实际随仓库提供的内容 | 来源及原许可 | 保留方式 |
| --- | --- | --- |
| integration_samples/sample-order.docx、sample-delivery.docx 中的默认样式、主题和缩略图 | python-docx 1.2.0 默认模板，MIT，Copyright (c) 2013 Steve Canny | 已匹配 `word/stylesWithEffects.xml`、`word/theme/theme1.xml` 和 `docProps/thumbnail.jpeg`。[完整许可](third_party_licenses/python-docx-LICENSE.txt) |
| integration_samples/sample-order.xlsx、sample-delivery.xlsx中的默认主题 | openpyxl 3.1.5默认主题；MIT，Copyright (c) 2010 openpyxl | [完整许可](third_party_licenses/openpyxl-LICENCE.txt)。已匹配xl/theme/theme1.xml。 |
| 其余合成业务内容、PNG及扫描PDF | 本地样例生成记录；未公开真实客户内容 | 模板的上游权利不被业务内容的自有授权替代。扫描PDF由PNG插入生成，未检测到嵌入字体软件的标记；此检查不构成完整字体审计。 |
| static/mark.svg | 原工程简单圆角底／勾形SVG；未发现外部引用或嵌入字体 | 随自有代码范围处理，不宣称已取得其他品牌的商标授权。 |

未复制第三方Python包源码、site-packages、Node／Python运行环境、EXE、DLL、模型权重或原Git历史进入本仓库；两份上游许可证原文随样例保留。下载者须通过官方分发渠道另行取得依赖及其随附许可。

## 默认文档能力及相关依赖

| 组件／观察版本 | 原许可摘要 | 官方来源 | 使用范围 |
| --- | --- | --- | --- |
| Node.js 24.19.0（原环境；运行要求>=22.13） | Node代码MIT，捆绑库各自许可 | [nodejs/node](https://github.com/nodejs/node) | 运行时，不随源码提供。 |
| Python 3.11.15（原环境） | PSF许可证及其组件许可 | [cpython](https://github.com/python/cpython) | 用户自行安装；本次未将旧嵌入式解释器转成公开包。 |
| python-docx 1.2.0 | MIT | [python-openxml/python-docx](https://github.com/python-openxml/python-docx) | Markdown相关处理、导出及Word辅助处理；样例还复制其模板内容。 |
| openpyxl 3.1.5 | MIT | [官方源码](https://foss.heptapod.net/openpyxl/openpyxl) | XLSX；样例复制其默认主题。 |
| xlrd 2.0.2 | BSD | [python-excel/xlrd](https://github.com/python-excel/xlrd) | 旧XLS。 |
| pdfplumber 0.11.10 | MIT | [jsvine/pdfplumber](https://github.com/jsvine/pdfplumber) | 原生PDF文字／表格。 |
| pdfminer.six 20260107 | MIT | [pdfminer/pdfminer.six](https://github.com/pdfminer/pdfminer.six) | pdfplumber依赖。 |
| Pillow 12.3.0 | MIT-CMU；捆绑原生组件另有许可 | [python-pillow/Pillow](https://github.com/python-pillow/Pillow) | 图像及PDF相关依赖。 |
| pypdfium2 5.13.0 | 绑定部分BSD-3-Clause／Apache-2.0等；PDFium及捆绑库各自许可 | [pypdfium2-team/pypdfium2](https://github.com/pypdfium2-team/pypdfium2) | pdfplumber传递依赖；本地包提供PDFium、FreeType、ICU、图像库等BUILD_LICENSES，不能仅用绑定许可概括全部原生库。 |
| lxml 6.1.2 | BSD及随附libxml2／libxslt等许可 | [lxml/lxml](https://github.com/lxml/lxml) | python-docx等传递依赖。 |
| LibreOffice（版本未核实） | 主体MPL-2.0，随附组件各自许可 | [官方许可](https://www.libreoffice.org/about-us/licenses/) | 可选独立DOC转换程序；本仓库不捆绑。 |

上表不是“全部直接依赖均为MIT”的声明。传递依赖和原生库必须按实际安装产物核对。[DEPENDENCIES.csv](DEPENDENCIES.csv)列出按本地Windows／CPython 3.11.15元数据计算的61个相关包：base组14个、images组2个、optional_ocr组51个，合并去重为61个。它不是安装指令、干净环境锁文件或完整法律结论；来源字段缺少仓库URL时仅提供对应PyPI发布索引，不冒充已核实的源码归档。Cython 3.2.9有Apache-2.0元数据，但本地缺少其许可正文证据，尚待补证。

CSV中的license_identifier_pending仅表示许可标识是否仍未知；false不等于相应组合授权、源码提供、模型权利或发布检查已完成。license_text_locally_present也仅表示找到本地许可文本证据。

## PyMuPDF 与 AGPL 组合

| 组件／版本 | 上游授权 | 当前调用位置 |
| --- | --- | --- |
| PyMuPDF 1.28.2及其MuPDF核心 | 本地COPYING／METADATA声明：GNU AGPL v3或Artifex商业许可 | legacy/ocr/file_utils.py顶层import fitz；integration/worker.py扫描PDF分支动态导入fitz。 |

来源为 PyMuPDF 1.28.2 上游发布。随候选保留 [该版本附带的 AGPL v3 原文](third_party_licenses/AGPL-3.0.txt)。本次依据 AGPL 路径处理适用组合。[上游许可原文](https://raw.githubusercontent.com/pymupdf/PyMuPDF/1.28.2/COPYING)

Verify 自有代码继续采用 MIT，适用的 PyMuPDF 组合按 AGPL v3 提供。基础文档清单与 PyMuPDF 选装清单分开。图片走 HTTP 识别也先导入 file_utils，适用相同的 PyMuPDF 依赖说明。

若选择依据AGPL使用或发布形成的组合程序，需结合实际组合范围落实：

1. 保留上游许可与版权、修改声明；适用范围内的组合按AGPL授予使用者相应权利，不能只附一个网址同时宣称组合仅MIT。
2. 按分发方式提供完整对应源码、所需修改及构建／安装材料，并按许可允许的方式安排所覆盖依赖的准确源码获取。只有上游首页链接，不等于在所有情况下已经履行源码提供义务；不要求无条件把所有依赖都塞进同一个Git仓库。
3. 对修改后的程序通过网络供用户交互时，按 AGPL 第13节提供适用的对应源码获取机会。本候选的 `/source` 页面提供本版本 Verify 下载、上游源码地址和许可原文。实际部署需核对该页对交互用户可访问、下载与运行版本匹配。
4. 不能把依法需提供的程序源码仅因放在私有目录而排除。密钥和客户数据不属于应公开的凭证；私有Python规则若参与形成该组合，则须另核对其源码授权范围。

Python内部直接导入并调用fitz是需要重点评估的连接。Node与Python之间的JSON／子进程边界、单独文件夹或让用户安装依赖，都不能单独证明构成独立作品。本轮没有作出“全部Node代码必须AGPL”或“所有上层代码都不受影响”的结论。

作者已确认按 AGPL 路径提供适用组合。公开候选整体的授权范围、PyMuPDF 和 MuPDF 版本、对应源码提供办法及安装步骤详见 [AGPL-COMBINED.md](AGPL-COMBINED.md)。

## 可选本地OCR与其他原生组件

下列是历史环境中的相关包，未作为已经验证的新环境安装方案，也不代表每条路径都会用到全部包。

| 组件／观察版本 | 原许可摘要及注意事项 | 官方来源 |
| --- | --- | --- |
| PaddleOCR 2.10.0 | Apache-2.0；包许可不自动证明所有模型权重许可 | [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) |
| PaddlePaddle 2.6.2 | Apache-2.0，随附组件保留各自许可 | [PaddlePaddle/Paddle](https://github.com/PaddlePaddle/Paddle) |
| NumPy 1.26.4 | BSD-3-Clause及捆绑数学库等许可 | [numpy/numpy](https://github.com/numpy/numpy) |
| opencv-python、opencv-contrib-python、opencv-python-headless 4.10.0.84 | 发行包装配MIT、OpenCV主体Apache-2.0，捆绑FFmpeg等另有许可 | [opencv-python](https://github.com/opencv/opencv-python)、[OpenCV](https://github.com/opencv/opencv) |
| FFmpeg（捆绑具体版本待按二进制补证） | 本地OpenCV LICENSE-3RD-PARTY记载LGPL-2.1；实际启用组件、版本与源码对应仍需核对 | [FFmpeg法律说明](https://ffmpeg.org/legal.html) |
| Shapely 2.1.2 | Shapely自身BSD-3-Clause；捆绑GEOS另有LGPL-2.1等 | [shapely/shapely](https://github.com/shapely/shapely) |
| GEOS 3.13.1（本地构建证据） | LGPL-2.1；不要把Shapely的BSD误套给GEOS | [libgeos/geos](https://github.com/libgeos/geos) |
| Albumentations 2.0.8 | 本地此版本LICENSE为MIT；不可按名称推断其他版本 | [albumentations-team/albumentations](https://github.com/albumentations-team/albumentations) |
| SciPy 1.17.1、scikit-image 0.26.0 | BSD及各自随附第三方许可 | [scipy/scipy](https://github.com/scipy/scipy)、[scikit-image](https://github.com/scikit-image/scikit-image) |
| requests 2.34.2 | Apache-2.0，保留NOTICE等适用声明 | [psf/requests](https://github.com/psf/requests) |
| certifi 2026.7.22 | MPL-2.0，相关文件级义务按实际修改／分发处理 | [certifi/python-certifi](https://github.com/certifi/python-certifi) |
| chardet 7.6.0 | 本地License-Expression为0BSD；不要套用其他历史版本许可 | [chardet/chardet](https://github.com/chardet/chardet) |
| tqdm 4.70.0 | MPL-2.0 AND MIT；保留文件及组件各自许可范围 | [tqdm/tqdm](https://github.com/tqdm/tqdm) |
| lmdb 2.3.0 | OLDAP-2.8 | [jnwatson/py-lmdb](https://github.com/jnwatson/py-lmdb) |

LGPL通常不要求把应用自有代码改成LGPL，但分发受覆盖库／修改版时仍需满足相应源码、许可及用户替换／重新链接等适用条件；不能只用本清单替代。若以后打包EXE／DLL／模型或复制wheel，须根据实际二进制重新准备随附许可、准确源码获取及其他材料。本仓库这次不捆绑这些运行产物。

三个OpenCV发行包在旧环境重叠，可能共享cv2路径；PaddleOCR及其传递依赖还会要求不同发行包。本轮没有解决干净安装冲突，也未修改业务代码来规避许可。

## 模型与未决事项

旧私有模型中有9个文件，目录名指向PP-OCRv4与角度分类模型，但缺少可核对的原下载地址、模型许可证及revision／哈希来源映射。它们继续保留在私有目录，不作公开模型分发，不以Apache-2.0包许可代替权重许可。用户即使自行下载，也须按实际模型的条件使用。

若发布范围以后包含模型或原生二进制，按实际产物补齐相应材料。
