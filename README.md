# UserScripts

个人用户脚本集合，包含各种实用的浏览器脚本。

## 脚本列表

### 夸克网盘空间占用分析

分析夸克网盘当前目录空间占用，并使用 ECharts 矩形树图展示。

- **安装地址**: [Greasy Fork](https://greasyfork.org/zh-CN/scripts/564638)
- **详细说明**: [查看文档](./夸克网盘空间占用分析/README.md)
- **版本**: v1.0
- **更新日期**: 2026-01-31

**功能特性**:

- 使用异步请求，浏览器不卡死
- 实时显示当前扫描的文件夹
- 可随时中断扫描
- 支持从任意目录开始扫描
- 可视化图表展示

---

### 工业和信息化部行业标准全文下载

在工业和信息化部行业标准全文列表的预览按钮下方添加下载按钮，便于直接下载标准 PDF。

- **安装地址**: [查看脚本源码](./工业和信息化部行业标准下载/工业和信息化部行业标准下载.js)
- **版本**: v1.0
- **适用网站**: [工业和信息化部行业标准全文公开系统](https://std.miit.gov.cn/)

**功能特性**:

- 在“预览”按钮下方自动添加“下载”按钮
- 自动获取标准预览 PDF 并触发浏览器下载

---

## 如何使用

1. 安装浏览器扩展：[Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)
2. 点击上方脚本的安装地址进行安装
3. 访问对应网站即可使用

## 开发说明

所有脚本均采用 **LGPL-3.0** 许可证，欢迎贡献代码。

### 目录结构

```
userscripts/
├── README.md                           # 本文件
├── 夸克网盘空间占用分析/
│   ├── README.md                       # 脚本说明
│   └── 夸克网盘空间占用分析.js           # 脚本源码
├── 工业和信息化部行业标准下载/
│   └── 工业和信息化部行业标准下载.js       # 脚本源码
└── ...                                 # 其他脚本
```

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

本项目采用 [LGPL-3.0](https://www.gnu.org/licenses/lgpl-3.0.html) 许可证。

## 联系方式

- GitHub: [@Augenstern-O](https://github.com/Augenstern-O)
- Greasy Fork: [个人主页](https://greasyfork.org/zh-CN/users/1566376)
