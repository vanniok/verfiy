# Verify 与 PyMuPDF 组合的授权和源码

发布候选版本 Verify 1.0.0，2026-11-05。

朱威有权授权的 Verify 自有代码继续依据 [MIT License](LICENSE) 单独提供。对以 PyMuPDF 1.28.2 组成、受 AGPL 覆盖的 Verify 组合，本发布候选按 [GNU Affero General Public License version 3](third_party_licenses/AGPL-3.0.txt) 整体提供。为明确这次提供的范围，组合包含公开候选中的网页、Node 服务、Python 桥与解析器、通用业务规则及相应安装和运行脚本。第三方组件和样例模板保留其原有授权及版权声明，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

Copyright (c) 2026 朱威。PyMuPDF 与 MuPDF 的版权归其相应权利人。依据上述许可证，收件人可在许可条件下复制、修改和再分发；软件按现状提供，适用的保证范围见许可证。

## 修改记录

- 2026-11-04 将公开源码副本的配置、运行数据和可选规则外置，增加明确的服务启用开关及非覆盖式初始化，保留通用文档处理和比较。
- 2026-11-05 增加组合授权、固定版本的第三方源码记录、源码打包脚本，以及页面上的源码与许可证入口。Verify 的文档处理与比较规则沿用上述副本实现。PyMuPDF 和 MuPDF 采用上游版本。

## 获取这一版本的源码

| 组件 | 源码及版本依据 |
| --- | --- |
| Verify 1.0.0 | 本目录即本次候选的可编辑源码。自带 `verify-source.zip` 时可经本实例的 `/source` 页面直接下载。打包包含入口、网页、后端、Python、规则、配置示例、样例和安装脚本。 |
| PyMuPDF 1.28.2 | 在 [官方发布文件页](https://pypi.org/project/pymupdf/1.28.2/#files) 选择 **pymupdf-1.28.2.tar.gz** 源码发行包。PyPI 记录的 SHA-256 为 `5e0be7908a715aa20333caddd73f1d6f01e4cd0c26e869fa2dd0b7f344da2249`。本地原安装的构建记录指向提交 [12786d12b2962a1d77fd13b103162eddf749644c](https://github.com/pymupdf/PyMuPDF/tree/12786d12b2962a1d77fd13b103162eddf749644c)。 |
| MuPDF 1.28.2 | PyMuPDF 的 [1.28.2 构建脚本](https://github.com/pymupdf/PyMuPDF/blob/1.28.2/setup.py) 与本地构建记录均指向 [MuPDF 1.28.2 官方源码包](https://mupdf.com/downloads/archive/mupdf-1.28.2-source.tar.gz)。按该版本源码和上游构建脚本取得原生核心及其构建所需材料。 |

上游文件从官方渠道单独取得。若使用经修改或以不同参数构建的包，提供实际版本对应的源码、补丁和构建材料。分发二进制时按 AGPL 第6节选择适用的对应源码提供方式，并维持可访问性。

## 安装和生成源码下载

按 [README.md](README.md) 初始化私有目录和独立 Python 环境。要在该环境中选装 PyMuPDF，使用它的 Python 解释器运行 `python -m pip install -r requirements-agpl.txt`。该清单还包含基础文档依赖。图片识别服务、模型和其各自授权仍需按所选 OCR 方式独立准备。

在候选源码根目录使用 Python 3.11 或兼容版本运行：

```powershell
python -I -S -B tools/package-source.py
```

脚本按 `tools/source-files.txt` 建立 `verify-source.zip`，已有同名包时会停止。源码、运行脚本或许可说明变更后，先把旧包移出程序目录，再生成当前版本包。新增源码文件也要更新清单。向用户提供网络交互前，确保同一实例的 `/source` 及其下载对所有交互用户可用，压缩包与运行版本相符，上游源码可免费访问。联系邮箱用于处理获取异常，页面直接提供下载路径。

此候选以通用业务规则和用户自行配置资源为边界。需要加装私有 Python 规则、修改版 OCR 代码或其他受覆盖部分时，先审查这些部分是否必须纳入对应源码，再确认是否适用现有包。客户数据、凭证、私有配置值和非程序运行数据不进入源码包。实际部署版本或二进制分发另有材料时，按实际组合提供。作者联系邮箱为 vanniok@163.com。
