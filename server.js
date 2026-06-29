const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const ADMIN_PASSWORD = 'admin123';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========== 数据读写 ==========
function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return { entries: [] };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ========== 简易 Token 会话 ==========
const sessions = {}; // token -> { role, name }

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function authMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!token || !sessions[token]) {
    return res.status(401).json({ error: '未登录' });
  }
  req.session = sessions[token];
  req.token = token;
  next();
}

// ========== 登录接口 ==========
app.post('/api/login', (req, res) => {
  const { name, password } = req.body;

  // 管理员登录
  if (password !== undefined && password !== '') {
    if (password === ADMIN_PASSWORD) {
      const token = generateToken();
      sessions[token] = { role: 'admin', name: '管理员' };
      return res.json({ token, role: 'admin', name: '管理员' });
    }
    return res.status(400).json({ error: '密码错误，请重新输入' });
  }

  // 普通用户登录（只需姓名）
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '请输入姓名' });
  }

  const token = generateToken();
  sessions[token] = { role: 'user', name: name.trim() };
  res.json({ token, role: 'user', name: name.trim() });
});

// ========== 退出登录 ==========
app.post('/api/logout', authMiddleware, (req, res) => {
  delete sessions[req.token];
  res.json({ ok: true });
});

// ========== 用户：新增登记 ==========
app.post('/api/entries', authMiddleware, (req, res) => {
  const { role, name } = req.session;
  if (role !== 'user') {
    return res.status(403).json({ error: '管理员无需登记' });
  }

  const { age, gender, hobby, remark } = req.body;
  if (!age || !gender) {
    return res.status(400).json({ error: '年龄和性别为必填项' });
  }

  const data = readData();
  const entry = {
    id: crypto.randomUUID(),
    name: name,
    age: Number(age),
    gender,
    hobby: hobby || '',
    remark: remark || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  data.entries.push(entry);
  writeData(data);
  res.json({ ok: true, entry });
});

// ========== 用户：查看自己的登记 ==========
app.get('/api/my-entries', authMiddleware, (req, res) => {
  const { role, name } = req.session;
  if (role !== 'user') {
    return res.status(403).json({ error: '无权限' });
  }

  const data = readData();
  const mine = data.entries.filter(e => e.name === name);
  res.json({ entries: mine });
});

// ========== 用户：修改自己的登记 ==========
app.put('/api/entries/:id', authMiddleware, (req, res) => {
  const { role, name } = req.session;
  if (role !== 'user') {
    return res.status(403).json({ error: '管理员无需修改' });
  }

  const data = readData();
  const entry = data.entries.find(e => e.id === req.params.id && e.name === name);
  if (!entry) {
    return res.status(404).json({ error: '记录不存在或无权修改' });
  }

  const { age, gender, hobby, remark } = req.body;
  if (age) entry.age = Number(age);
  if (gender) entry.gender = gender;
  if (hobby !== undefined) entry.hobby = hobby;
  if (remark !== undefined) entry.remark = remark;
  entry.updatedAt = new Date().toISOString();

  writeData(data);
  res.json({ ok: true, entry });
});

// ========== 用户：删除自己的登记 ==========
app.delete('/api/entries/:id', authMiddleware, (req, res) => {
  const { role, name } = req.session;
  if (role !== 'user') {
    return res.status(403).json({ error: '管理员无需删除' });
  }

  const data = readData();
  const idx = data.entries.findIndex(e => e.id === req.params.id && e.name === name);
  if (idx === -1) {
    return res.status(404).json({ error: '记录不存在或无权删除' });
  }

  data.entries.splice(idx, 1);
  writeData(data);
  res.json({ ok: true });
});

// ========== 管理员：查看所有登记 ==========
app.get('/api/entries', authMiddleware, (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: '无权限' });
  }
  const data = readData();
  res.json({ entries: data.entries });
});

// ========== 管理员：删除任意记录 ==========
app.delete('/api/admin/entries/:id', authMiddleware, (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: '无权限' });
  }

  const data = readData();
  const idx = data.entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: '记录不存在' });
  }

  data.entries.splice(idx, 1);
  writeData(data);
  res.json({ ok: true });
});

// ========== 统计接口（用户可看总数，管理员看全部统计） ==========
app.get('/api/stats', authMiddleware, (req, res) => {
  const data = readData();
  const entries = data.entries;

  // 基础统计
  const total = entries.length;
  const maleCount = entries.filter(e => e.gender === '男').length;
  const femaleCount = entries.filter(e => e.gender === '女').length;

  // 年龄分布
  const ageGroups = { '18以下': 0, '18-25': 0, '26-35': 0, '36-45': 0, '46以上': 0 };
  entries.forEach(e => {
    const age = e.age;
    if (age < 18) ageGroups['18以下']++;
    else if (age <= 25) ageGroups['18-25']++;
    else if (age <= 35) ageGroups['26-35']++;
    else if (age <= 45) ageGroups['36-45']++;
    else ageGroups['46以上']++;
  });

  // 爱好统计
  const hobbyMap = {};
  entries.forEach(e => {
    if (e.hobby) {
      e.hobby.split(/[,，、\s]+/).forEach(h => {
        h = h.trim();
        if (h) hobbyMap[h] = (hobbyMap[h] || 0) + 1;
      });
    }
  });

  const basicStats = { total, maleCount, femaleCount };

  if (req.session.role === 'admin') {
    return res.json({
      ...basicStats,
      ageGroups,
      hobbies: hobbyMap,
      entries
    });
  }

  // 普通用户只看到总数
  res.json(basicStats);
});

// ========== 管理员：导出 Excel ==========
app.get('/api/export', authMiddleware, async (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: '无权限' });
  }

  const data = readData();
  const entries = data.entries;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = '团队登记工具';
  const sheet = workbook.addWorksheet('登记记录');

  // 表头
  sheet.columns = [
    { header: '序号', key: 'index', width: 8 },
    { header: '姓名', key: 'name', width: 14 },
    { header: '年龄', key: 'age', width: 8 },
    { header: '性别', key: 'gender', width: 8 },
    { header: '爱好', key: 'hobby', width: 24 },
    { header: '备注', key: 'remark', width: 30 },
    { header: '登记时间', key: 'createdAt', width: 22 }
  ];

  // 表头样式
  sheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true, size: 12 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F6EF7' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' }
    };
  });
  sheet.getRow(1).height = 26;

  // 写入数据
  entries.forEach((e, i) => {
    const row = sheet.addRow({
      index: i + 1,
      name: e.name,
      age: e.age,
      gender: e.gender,
      hobby: e.hobby,
      remark: e.remark,
      createdAt: new Date(e.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    });
    row.eachCell(cell => {
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' }
      };
    });
    row.getCell('remark').alignment = { vertical: 'middle', horizontal: 'left' };
    row.getCell('hobby').alignment = { vertical: 'middle', horizontal: 'left' };
  });

  // 设置响应头
  const filename = encodeURIComponent(`团队登记_${new Date().toLocaleDateString('zh-CN')}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);

  await workbook.xlsx.write(res);
  res.end();
});

// ========== 启动 ==========
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 团队登记工具已启动: http://localhost:${PORT}`);
  console.log(`📱 手机访问: http://<你的IP>:${PORT}`);
  console.log(`🔑 管理员密码: ${ADMIN_PASSWORD}`);
});
