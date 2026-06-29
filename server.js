const express = require('express');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'admin123';

// ========== 数据库连接 ==========
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_64xvCoVdEmwj@ep-shy-forest-aog32ggz-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========== 初始化数据库 ==========
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS reg_team_info (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        age INTEGER NOT NULL,
        gender VARCHAR(10) NOT NULL,
        hobby VARCHAR(200) DEFAULT '',
        remark TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ 数据表 reg_team_info 已就绪');

    // 检查是否有数据，没有则插入测试数据
    const result = await client.query('SELECT COUNT(*) FROM reg_team_info');
    if (parseInt(result.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO reg_team_info (id, name, age, gender, hobby, remark)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [crypto.randomUUID(), '测试用户', 28, '男', '篮球, 阅读', '这是一条测试数据']);
      console.log('✅ 已插入测试数据');
    }
  } catch (err) {
    console.error('❌ 数据库初始化失败:', err.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

// ========== 简易 Token 会话 ==========
const sessions = {};

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

  if (password !== undefined && password !== '') {
    if (password === ADMIN_PASSWORD) {
      const token = generateToken();
      sessions[token] = { role: 'admin', name: '管理员' };
      return res.json({ token, role: 'admin', name: '管理员' });
    }
    return res.status(400).json({ error: '密码错误，请重新输入' });
  }

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
app.post('/api/entries', authMiddleware, async (req, res) => {
  const { role, name } = req.session;
  if (role !== 'user') {
    return res.status(403).json({ error: '管理员无需登记' });
  }

  const { age, gender, hobby, remark } = req.body;
  if (!age || !gender) {
    return res.status(400).json({ error: '年龄和性别为必填项' });
  }

  try {
    const id = crypto.randomUUID();
    const now = new Date();
    await pool.query(
      `INSERT INTO reg_team_info (id, name, age, gender, hobby, remark, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, name, Number(age), gender, hobby || '', remark || '', now, now]
    );
    res.json({ ok: true, entry: { id, name, age: Number(age), gender, hobby: hobby || '', remark: remark || '', createdAt: now, updatedAt: now } });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ========== 用户：查看自己的登记 ==========
app.get('/api/my-entries', authMiddleware, async (req, res) => {
  const { role, name } = req.session;
  if (role !== 'user') {
    return res.status(403).json({ error: '无权限' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM reg_team_info WHERE name = $1 ORDER BY created_at DESC',
      [name]
    );
    const entries = result.rows.map(formatEntry);
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ========== 用户：修改自己的登记 ==========
app.put('/api/entries/:id', authMiddleware, async (req, res) => {
  const { role, name } = req.session;
  if (role !== 'user') {
    return res.status(403).json({ error: '管理员无需修改' });
  }

  const { age, gender, hobby, remark } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM reg_team_info WHERE id = $1 AND name = $2',
      [req.params.id, name]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '记录不存在或无权修改' });
    }

    const entry = result.rows[0];
    const updated = await pool.query(
      `UPDATE reg_team_info SET age = $1, gender = $2, hobby = $3, remark = $4, updated_at = $5
       WHERE id = $6 RETURNING *`,
      [
        age ? Number(age) : entry.age,
        gender || entry.gender,
        hobby !== undefined ? hobby : entry.hobby,
        remark !== undefined ? remark : entry.remark,
        new Date(),
        req.params.id
      ]
    );
    res.json({ ok: true, entry: formatEntry(updated.rows[0]) });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ========== 用户：删除自己的登记 ==========
app.delete('/api/entries/:id', authMiddleware, async (req, res) => {
  const { role, name } = req.session;
  if (role !== 'user') {
    return res.status(403).json({ error: '管理员无需删除' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM reg_team_info WHERE id = $1 AND name = $2 RETURNING id',
      [req.params.id, name]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '记录不存在或无权删除' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ========== 管理员：查看所有登记 ==========
app.get('/api/entries', authMiddleware, async (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: '无权限' });
  }
  try {
    const result = await pool.query('SELECT * FROM reg_team_info ORDER BY created_at DESC');
    res.json({ entries: result.rows.map(formatEntry) });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ========== 管理员：删除任意记录 ==========
app.delete('/api/admin/entries/:id', authMiddleware, async (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: '无权限' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM reg_team_info WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '记录不存在' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ========== 统计接口 ==========
app.get('/api/stats', authMiddleware, async (req, res) => {
  try {
    const all = await pool.query('SELECT * FROM reg_team_info');
    const entries = all.rows;

    const total = entries.length;
    const maleCount = entries.filter(e => e.gender === '男').length;
    const femaleCount = entries.filter(e => e.gender === '女').length;

    const ageGroups = { '18以下': 0, '18-25': 0, '26-35': 0, '36-45': 0, '46以上': 0 };
    entries.forEach(e => {
      const age = e.age;
      if (age < 18) ageGroups['18以下']++;
      else if (age <= 25) ageGroups['18-25']++;
      else if (age <= 35) ageGroups['26-35']++;
      else if (age <= 45) ageGroups['36-45']++;
      else ageGroups['46以上']++;
    });

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
        entries: entries.map(formatEntry)
      });
    }

    res.json(basicStats);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// ========== 管理员：导出 Excel ==========
app.get('/api/export', authMiddleware, async (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: '无权限' });
  }

  try {
    const result = await pool.query('SELECT * FROM reg_team_info ORDER BY created_at DESC');
    const entries = result.rows;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = '团队登记工具';
    const sheet = workbook.addWorksheet('登记记录');

    sheet.columns = [
      { header: '序号', key: 'index', width: 8 },
      { header: '姓名', key: 'name', width: 14 },
      { header: '年龄', key: 'age', width: 8 },
      { header: '性别', key: 'gender', width: 8 },
      { header: '爱好', key: 'hobby', width: 24 },
      { header: '备注', key: 'remark', width: 30 },
      { header: '登记时间', key: 'createdAt', width: 22 }
    ];

    sheet.getRow(1).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F6EF7' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' }
      };
    });
    sheet.getRow(1).height = 26;

    entries.forEach((e, i) => {
      const row = sheet.addRow({
        index: i + 1,
        name: e.name,
        age: e.age,
        gender: e.gender,
        hobby: e.hobby,
        remark: e.remark,
        createdAt: new Date(e.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
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

    const filename = encodeURIComponent(`团队登记_${new Date().toLocaleDateString('zh-CN')}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: '导出失败' });
  }
});

// ========== 工具函数：格式化数据库行 ==========
function formatEntry(row) {
  return {
    id: row.id,
    name: row.name,
    age: row.age,
    gender: row.gender,
    hobby: row.hobby,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ========== 启动 ==========
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ 团队登记工具已启动: http://localhost:${PORT}`);
    console.log(`📱 手机访问: http://<你的IP>:${PORT}`);
    console.log(`🔑 管理员密码: ${ADMIN_PASSWORD}`);
  });
});
