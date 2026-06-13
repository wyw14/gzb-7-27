const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 3127;

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

const userRoutes = require('./routes/users');
const instrumentRoutes = require('./routes/instruments');
const borrowRoutes = require('./routes/borrows');
const invitationRoutes = require('./routes/invitations');
const checkinRoutes = require('./routes/checkins');
const reviewRoutes = require('./routes/reviews');
const recommendRoutes = require('./routes/recommendations');
const { router: messageRoutes, checkAndGenerateReminders } = require('./routes/messages');

app.use('/api/users', userRoutes);
app.use('/api/instruments', instrumentRoutes);
app.use('/api/borrows', borrowRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api/checkins', checkinRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/recommendations', recommendRoutes);
app.use('/api/messages', messageRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '旧乐器流转与练习搭子平台服务运行中' });
});

app.listen(PORT, () => {
  console.log(`服务端运行在 http://localhost:${PORT}`);
  try {
    const result = checkAndGenerateReminders();
    console.log(`逾期提醒检查完成：新生成 ${result.generated} 条，总计 ${result.total} 条`);
  } catch (e) {
    console.error('逾期提醒检查失败:', e);
  }
});

