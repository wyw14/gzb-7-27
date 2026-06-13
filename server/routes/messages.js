const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readJSON, writeJSON } = require('../utils/storage');

const router = express.Router();

const REMIND_DAYS = 3;

function getDaysDiff(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(dateStr);
  endDate.setHours(0, 0, 0, 0);
  const diff = endDate.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function checkAndGenerateReminders() {
  const borrows = readJSON('borrows.json', []);
  const messages = readJSON('messages.json', []);
  const instruments = readJSON('instruments.json', []);
  const users = readJSON('users.json', []);

  const borrowingRecords = borrows.filter(b => b.status === 'borrowing');
  const existingKeys = new Set(messages.map(m => m.uniqueKey));

  let newCount = 0;

  borrowingRecords.forEach(b => {
    const daysDiff = getDaysDiff(b.endDate);
    const instrument = instruments.find(i => i.id === b.instrumentId);
    const borrower = users.find(u => u.id === b.borrowerId);
    const owner = users.find(u => u.id === b.ownerId);

    if (daysDiff < 0) {
      const overdueDays = Math.abs(daysDiff);
      const borrowerKey = `overdue_borrower_${b.id}`;
      if (!existingKeys.has(borrowerKey)) {
        messages.push({
          id: 'm' + uuidv4().slice(0, 8),
          userId: b.borrowerId,
          type: 'overdue_borrower',
          uniqueKey: borrowerKey,
          borrowId: b.id,
          instrumentId: b.instrumentId,
          instrumentName: instrument?.name || '',
          instrumentImage: instrument?.image || '',
          counterpartId: b.ownerId,
          counterpartName: owner?.username || '',
          counterpartAvatar: owner?.avatar || '',
          endDate: b.endDate,
          overdueDays,
          title: '⚠️ 乐器已逾期',
          content: `您借用的【${instrument?.name || '乐器'}】已逾期 ${overdueDays} 天，请尽快归还！`,
          read: false,
          createdAt: new Date().toISOString()
        });
        newCount++;
      }

      const ownerKey = `overdue_owner_${b.id}`;
      if (!existingKeys.has(ownerKey)) {
        messages.push({
          id: 'm' + uuidv4().slice(0, 8),
          userId: b.ownerId,
          type: 'overdue_owner',
          uniqueKey: ownerKey,
          borrowId: b.id,
          instrumentId: b.instrumentId,
          instrumentName: instrument?.name || '',
          instrumentImage: instrument?.image || '',
          counterpartId: b.borrowerId,
          counterpartName: borrower?.username || '',
          counterpartAvatar: borrower?.avatar || '',
          endDate: b.endDate,
          overdueDays,
          title: '⚠️ 借出乐器已逾期',
          content: `【${borrower?.username || '用户'}】借用的【${instrument?.name || '乐器'}】已逾期 ${overdueDays} 天，请及时跟进归还事宜。`,
          read: false,
          createdAt: new Date().toISOString()
        });
        newCount++;
      }
    } else if (daysDiff <= REMIND_DAYS) {
      const borrowerKey = `upcoming_borrower_${b.id}`;
      if (!existingKeys.has(borrowerKey)) {
        messages.push({
          id: 'm' + uuidv4().slice(0, 8),
          userId: b.borrowerId,
          type: 'upcoming_borrower',
          uniqueKey: borrowerKey,
          borrowId: b.id,
          instrumentId: b.instrumentId,
          instrumentName: instrument?.name || '',
          instrumentImage: instrument?.image || '',
          counterpartId: b.ownerId,
          counterpartName: owner?.username || '',
          counterpartAvatar: owner?.avatar || '',
          endDate: b.endDate,
          remainingDays: daysDiff,
          title: daysDiff === 0 ? '🔔 今日需归还乐器' : `🔔 距归还还有 ${daysDiff} 天`,
          content: daysDiff === 0
            ? `您借用的【${instrument?.name || '乐器'}】今日到期，请记得按时归还！`
            : `您借用的【${instrument?.name || '乐器'}】还有 ${daysDiff} 天到期，请提前做好归还准备。`,
          read: false,
          createdAt: new Date().toISOString()
        });
        newCount++;
      }

      const ownerKey = `upcoming_owner_${b.id}`;
      if (!existingKeys.has(ownerKey)) {
        messages.push({
          id: 'm' + uuidv4().slice(0, 8),
          userId: b.ownerId,
          type: 'upcoming_owner',
          uniqueKey: ownerKey,
          borrowId: b.id,
          instrumentId: b.instrumentId,
          instrumentName: instrument?.name || '',
          instrumentImage: instrument?.image || '',
          counterpartId: b.borrowerId,
          counterpartName: borrower?.username || '',
          counterpartAvatar: borrower?.avatar || '',
          endDate: b.endDate,
          remainingDays: daysDiff,
          title: daysDiff === 0 ? '🔔 今日乐器应归还' : `🔔 距乐器归还还有 ${daysDiff} 天`,
          content: daysDiff === 0
            ? `【${borrower?.username || '用户'}】借用的【${instrument?.name || '乐器'}】今日到期，请留意归还情况。`
            : `【${borrower?.username || '用户'}】借用的【${instrument?.name || '乐器'}】还有 ${daysDiff} 天到期，可适当提醒对方。`,
          read: false,
          createdAt: new Date().toISOString()
        });
        newCount++;
      }
    }
  });

  writeJSON('messages.json', messages);
  return { generated: newCount, total: messages.length };
}

router.post('/check', (req, res) => {
  const result = checkAndGenerateReminders();
  res.json({ success: true, ...result });
});

router.get('/user/:userId', (req, res) => {
  checkAndGenerateReminders();
  const { userId } = req.params;
  const messages = readJSON('messages.json', []);
  const result = messages
    .filter(m => m.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(result);
});

router.get('/user/:userId/unread', (req, res) => {
  checkAndGenerateReminders();
  const { userId } = req.params;
  const messages = readJSON('messages.json', []);
  const unread = messages.filter(m => m.userId === userId && !m.read);
  res.json({ unreadCount: unread.length, messages: unread });
});

router.put('/:id/read', (req, res) => {
  const messages = readJSON('messages.json', []);
  const idx = messages.findIndex(m => m.id === req.params.id);

  if (idx === -1) {
    return res.status(404).json({ error: '消息不存在' });
  }

  messages[idx].read = true;
  messages[idx].readAt = new Date().toISOString();
  writeJSON('messages.json', messages);

  res.json({ success: true, message: messages[idx] });
});

router.put('/user/:userId/read-all', (req, res) => {
  const { userId } = req.params;
  const messages = readJSON('messages.json', []);
  let count = 0;

  messages.forEach(m => {
    if (m.userId === userId && !m.read) {
      m.read = true;
      m.readAt = new Date().toISOString();
      count++;
    }
  });

  writeJSON('messages.json', messages);
  res.json({ success: true, markedCount: count });
});

router.delete('/:id', (req, res) => {
  const messages = readJSON('messages.json', []);
  const idx = messages.findIndex(m => m.id === req.params.id);

  if (idx === -1) {
    return res.status(404).json({ error: '消息不存在' });
  }

  messages.splice(idx, 1);
  writeJSON('messages.json', messages);

  res.json({ success: true });
});

module.exports = { router, checkAndGenerateReminders };
