# Verify 综合工作台

制造业单据处理、人工核对与审核的软件演示工程。由朱威提供，使用AI辅助方案讨论、代码生成、重构和文档整理；业务判断、授权范围与发布责任由人确认。AI辅助不表示代码天然无第三方权利，也不构成安全或生产可用性认证。

**Verify 自有代码采用 MIT，与 PyMuPDF 的适用组合按 AGPL v3 提供。**

## 可以做什么

- 演示账号登录、人员工作台、单据归属及审核分配。
- 文本／Word／表格／原生PDF解析、双栏查看、编辑、保存与导出；具体格式取决于选装依赖。
- 两份已保存单据的订单号、零件、单位和数量比较，人工确认、提交与审核。
- 旧四字段单据核验演示、英文报告及操作记录。其演示识别使用合成样例规则，不是真实OCR性能证明。
- 微信客服／企微消息集中查看与身份接入代码；真实平台配置、联调及外部服务不随源码提供。当前没有已完成的对外回复或模型自动回复功能。

本仓库不包含客户数据、真实凭证、专属仓库规则、EXE、运行环境、模型权重或旧Git历史。`integration_samples` 为合成业务样例，不代表客户或销售业绩。

## 最快启动：先看Node演示

需要自行安装Node.js **22.13或更高版本**。本项目无第三方npm运行依赖，不必先执行npm install。以下命令均在本源码目录执行：

```powershell
node --version
node tools/init-private.mjs
node tools/start-local.mjs
```

默认打开 [http://127.0.0.1:8791](http://127.0.0.1:8791)。可以使用界面提供的演示身份，或操作员 `operator@atlas.demo`、审核员 `reviewer@atlas.demo`，共享演示密码 `Demo2026!`。这些是公开演示凭据，不能作为生产账号使用。

没有Python、模型或外部服务时仍能查看界面和旧四字段演示。真实文档处理中的Python功能会提示缺少配置，不会自动连接作者服务或下载模型。自动业务样例填充默认关闭；若需预置合成记录，可在确认后将私有app配置中的seed_demo改为true。

使用 Ctrl+C 停止本实例。Windows 也可使用 START.bat 和 STOP.bat。停止脚本按本副本 PID 和命令行确认实例，依赖 Windows 允许查询该进程。

## 私有配置与运行数据

默认私有目录是源码目录同级的 `02_私有资料_禁止上传`。可在启动前明确设置其他位置：

```powershell
$env:VERIFY_PRIVATE_DIR = 'C:\path\to\private-resources'
node tools/init-private.mjs
```

这个环境变量需在初始化及启动时保持一致。私有目录与源码目录不得互相包含。初始化只创建缺失文件，不覆盖已有配置；不要用示例强行覆盖原配置。

| 私有位置 | 内容 |
| --- | --- |
| config/app.json | 路径、Python、OCR模式、网络总开关及部署设置 |
| config/wecom.json | 企微应用等真实配置，默认禁用 |
| config/wechat-demo.json | 客服／企微中继配置，默认禁用 |
| config/ocr.json | 旧四字段HTTP识别连接配置，默认禁用 |
| data | 数据库、上传原件、报告及业务记录 |
| runtime | 缓存、临时文件、进程记录与启动日志 |
| generated-samples | 程序生成的合成PDF样例 |

配置示例见 `config/*.example.json`，均为空白或通用默认值。应用不回读原程序配置，不继承终端里旧的OCR服务地址。详见[配置与目录说明](配置与目录说明.md)。

## 选装Python文档能力

建议使用独立安装的Python **3.11**，在私有目录建立新的虚拟环境。以下示例只适用于目标目录尚不存在的情况，不要覆盖既有环境：

```powershell
# 先按上节设置VERIFY_PRIVATE_DIR；下面不使用作者随附的旧环境。
$verifyVenv = Join-Path $env:VERIFY_PRIVATE_DIR 'runtime\venv'
if (Test-Path -LiteralPath $verifyVenv) { throw '目标已存在，请复用或另选新目录，勿覆盖。' }
py -3.11 -m venv $verifyVenv
& (Join-Path $verifyVenv 'Scripts\python.exe') -m pip install -r requirements-documents.txt
```

然后手动编辑私有 `config/app.json` 的 `python_executable` 为 `runtime/venv/Scripts/python.exe`。它是相对私有目录的路径，也可以明确填写已安装Python的绝对路径。数据、模型及规则等资源路径必须留在私有目录内。

| 能力 | 依赖及限制 |
| --- | --- |
| TXT、CSV、原DOCX读取、通用订单比较 | 配置Python；主要使用标准库。 |
| Markdown解析及导出；DOC／XLS／XLSX；原生PDF | 安装requirements-documents.txt。旧二进制DOC还需要用户另装LibreOffice；其版本、转换效果未验证。 |
| 图片、扫描PDF | 当前还需要PyMuPDF和Pillow；HTTP图片入口也会导入PyMuPDF。通过 `requirements-agpl.txt` 明确选装，适用组合的授权和源码见 AGPL-COMBINED.md。 |
| 本地PaddleOCR | 另需PaddleOCR、PaddlePaddle、OpenCV及完整离线模型；不包含在上述安装组中。历史环境存在重叠OpenCV包，不能照抄为已验证安装方案。 |

依赖清单固定本地观察到的直接包版本。全新环境安装和传递依赖解析尚未验证。

## OCR与外部连接

`app.json` 默认 `allow_network:false`、`ocr_mode:"disabled"`、`seed_demo:false`。启用真实服务之前需自行确认授权、数据流向、服务费用及隐私要求。

- 主工作台图片OCR：local需要明确model_dir及完整离线模型；http需要明确ocr_url和allow_network。失败不会静默改用其他服务。
- 现有本地模型布局为 `whl/det/ch/ch_PP-OCRv4_det_infer`、`whl/rec/ch/ch_PP-OCRv4_rec_infer`、`whl/cls/ch_ppocr_mobile_v2.0_cls_infer`。每个目录需包含inference.pdmodel和inference.pdiparams等相应文件。本仓库不提供权重、下载脚本或来源未核实的模型授权保证。
- 旧四字段HTTP OCR、企微及客服中继，还需各自私有配置的enabled:true。只改地址不会自动启用。
- 可选专属规则通过business_profile_module明确加载。缺少配置时通用模式可用；明确选择专属模式但未提供规则时会报错。
- 默认只监听本机回环地址。不要直接作为互联网生产服务部署；生产账号、访问控制、备份与运维安排另行评估。

网络开关是本应用已核对连接入口的控制，不是操作系统防火墙，也不能替代对自行安装插件、依赖或私有规则代码的审查。

## 代码概览与检查

```text
server.mjs → backend/server.mjs        主入口、会话、请求分发
static/                                浏览器界面与操作
backend/workbench.mjs                   转化、编辑、核对与审核
backend/local-documents.mjs             私有Python桥
integration/worker.py                   文档解析、比较与导出
legacy/ocr/、legacy/compare/             复用的解析器与业务规则
backend/store.mjs、backend/resources.mjs 存储及私有配置边界
```

`npm test` 运行仓库内使用模拟 fetch 的浏览器请求测试。发布前另在 Windows 隔离环境验证了演示启动、单据处理与审核、私有配置、模拟 OCR 和客服中继。真实 OCR 模型、微信及企业微信平台联调、全新依赖安装和生产部署尚未验证。

## 许可证与来源

[LICENSE](LICENSE) 的MIT授权覆盖朱威有权授权的自有部分。与PyMuPDF的适用组合按AGPL v3提供，模型、依赖和上游模板保留各自的授权。版本、来源与原生库见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

页面底部的「源码与许可证」进入本实例的 `/source`。从源码检出启动时，可先执行 `python -I -S -B tools/package-source.py` 生成该页面提供的 `verify-source.zip`。如要启用AGPL组合或向网络用户提供交互，按版本核对Verify压缩包、PyMuPDF和MuPDF源码与实际运行内容。具体安装、维护和授权范围见 [AGPL-COMBINED.md](AGPL-COMBINED.md)。

维护联系：朱威，vanniok@163.com。当前未提供虚构仓库地址、正式客户承诺或商业支持保证。
