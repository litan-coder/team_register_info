const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

app.use(express.json());
app.use(express.static('public'));

const jsonFile = path.join(__dirname, 'data.json');

app.get('/api/list', (req, res) => {
  fs.readFile(jsonFile, 'utf8', (err, text) => {
    if (err) return res.json([]);
    res.json(JSON.parse(text));
  });
});

app.post('/api/save', (req, res) => {
  const info = req.body;
  fs.readFile(jsonFile, 'utf8', (err, text) => {
    let data = err ? [] : JSON.parse(text);
    if (info.id) {
      data = data.map(item => item.id === info.id ? info : item);
    } else {
      info.id = Date.now();
      data.push(info);
    }
    fs.writeFile(jsonFile, JSON.stringify(data, null, 2), () => {
      res.json({ code: 200, msg: '保存成功' });
    });
  });
});

app.post('/api/delete', (req, res) => {
  const { id } = req.body;
  fs.readFile(jsonFile, 'utf8', (err, text) => {
    let data = err ? [] : JSON.parse(text);
    data = data.filter(item => item.id != id);
    fs.writeFile(jsonFile, JSON.stringify(data, null, 2), () => {
      res.json({ code: 200, msg: '删除成功' });
    });
  });
});

app.listen(PORT, () => {
  console.log(`服务运行成功！本地地址：http://localhost:${PORT}`);
});