# 团队信息登记工具

轻量级团队信息登记系统，Node.js + HTML + JSON 文件存储。

## 启动

```bash
cd team-register
npm install
npm start
```

浏览器打开 `http://localhost:3000`

## 功能说明

### 用户端
- 输入姓名即可登录（无需注册）
- 填写登记信息：年龄、性别（男/女选择）、爱好、备注
- 查看总登记人数（仅显示数字，看不到他人信息）
- 修改 / 删除自己填写的记录

### 管理员
- 登录密码：`admin123`（可在 server.js 中修改）
- 查看全部统计：总人数、男女比例、年龄分布、爱好排行
- 查看所有登记记录详情
- 删除任意记录

## 文件结构

```
team-register/
├── server.js       # 后端服务
├── data.json       # 数据存储
├── public/
│   └── index.html  # 前端页面
└── package.json
```

## 手机访问

启动后查看本机 IP，手机浏览器访问 `http://<你的IP>:3000`

页面已适配移动端，支持响应式布局。
