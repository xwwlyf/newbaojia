# 报价查询系统

一个纯前端的报价查询系统，支持上传 Excel 报价文件并在浏览器中快速搜索产品报价。

## 功能特性

- 🔍 **快速搜索**：按型号关键词搜索报价，支持模糊匹配
- 📊 **Excel 上传**：支持 .xlsx / .xls 格式报价文件上传
- 📁 **多文件管理**：支持上传和管理多个报价文件，可按文件筛选搜索结果
- 💾 **本地存储**：基于 IndexedDB 的纯浏览器端存储，数据不上传服务器
- 📋 **后台管理**：文件上传、覆盖、删除、统计等管理功能

## 页面结构

- `index.html` — 报价查询主页（搜索入口）
- `admin.html` — 管理后台（文件上传与管理）
- `css/style.css` — 全局样式
- `js/db.js` — IndexedDB 数据库操作封装
- `js/search.js` — 搜索功能逻辑
- `js/admin.js` — 管理后台逻辑

## 快速开始

直接用浏览器打开 `index.html` 即可使用。无需服务器、无需构建。

> **提示**：由于使用了 IndexedDB，需要通过 HTTP(S) 协议访问（直接双击打开 `file://` 协议可能导致部分功能异常）。推荐使用 VS Code Live Server 或任意静态文件服务器。

## 技术栈

- 原生 HTML / CSS / JavaScript
- [SheetJS](https://sheetjs.com/) (xlsx) — Excel 文件解析
- IndexedDB — 浏览器端数据持久化

## License

MIT
