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

function cleanupRemindersByBorrowId(borrowId) {
  const messages = readJSON('messages.json', []);
  const beforeCount = messages.length;
  const filtered = messages.filter(m => m.borrowId !== borrowId);
  if (filtered.length !== beforeCount) {
    writeJSON('messages.json', filtered);
  }
  return beforeCount - filtered.length;
}

function buildReminderMessage({ borrow, role, status, daysDiff, instrument, user, counterpart }) {
  const days = Math.abs(daysDiff);
  const typePrefix = status;
  const typeSuffix = role;
  const type = `${typePrefix}_${typeSuffix}`;

  const base = {
    id: 'm' + uuidv4().slice(0, 8),
    userId: user.id,
    type,
    borrowId: borrow.id,
    instrumentId: borrow.instrumentId,
    instrumentName: instrument?.name || '',
    instrumentImage: instrument?.image || '',
    counterpartId: counterpart.id,
    counterpartName: counterpart?.username || '',
    counterpartAvatar: counterpart?.avatar || '',
    endDate: borrow.endDate,
    read: false,
    createdAt: new Date().toISOString()
  };

  if (status === 'overdue') {
    return {
      ...base,
      uniqueKey: `${type}_${borrow.id}_${days}`,
      overdueDays: days,
      title: role === 'borrower' ? '⚠️ 乐器已逾期' : '⚠️ 借出乐器已逾期',
      content: role === 'borrower'
        ? `您借用的【${instrument?.name || '乐器'}】已逾期 ${days} 天，请尽快归还！`
        : `【${counterpart?.username || '用户'}】借用的【${instrument?.name || '乐器'}】已逾期 ${days} 天，请及时跟进归还事宜。`
    };
  } else {
    return {
      ...base,
      uniqueKey: `${type}_${borrow.id}_${days}`,
      remainingDays: daysDiff,
      title: daysDiff === 0
        ? (role === 'borrower' ? '🔔 今日需归还乐器' : '🔔 今日乐器应归还')
        : `🔔 距归还还有 ${daysDiff} 天`,
      content: daysDiff === 0
        ? (role === 'borrower'
            ? `您借用的【${instrument?.name || '乐器'}】今日到期，请记得按时归还！`
            : `【${counterpart?.username || '用户'}】借用的【${instrument?.name || '乐器'}】今日到期，请留意归还情况。`)
        : (role === 'borrower'
            ? `您借用的【${instrument?.name || '乐器'}】还有 ${daysDiff} 天到期，请提前做好归还准备。`
            : `【${counterpart?.username || '用户'}】借用的【${instrument?.name || '乐器'}】还有 ${daysDiff} 天到期，可适当提醒对方。`)
    };
  }
}

function checkAndGenerateReminders() {
  const borrows = readJSON('borrows.json', []);
  const instruments = readJSON('instruments.json', []);
  const users = readJSON('users.json', []);
  let messages = readJSON('messages.json', []);

  const borrowingSet = new Set(
    borrows.filter(b => b.status === 'borrowing').map(b => b.id)
  );

  const beforeTotal = messages.length;
  messages = messages.filter(m => {
    if (!m.borrowId) return true;
    return borrowingSet.has(m.borrowId);
  });
  const removedStale = beforeTotal - messages.length;

  const existingKeys = new Map(messages.map(m => [m.uniqueKey, m]));
  const currentKeys = new Set();
  let updatedCount = 0;
  let newCount = 0;

  borrows.filter(b => b.status === 'borrowing').forEach(b => {
    const daysDiff = getDaysDiff(b.endDate);
    if (daysDiff > REMIND_DAYS) return;

    const instrument = instruments.find(i => i.id === b.instrumentId);
    const borrower = users.find(u => u.id === b.borrowerId);
    const owner = users.find(u => u.id === b.ownerId);

    const status = daysDiff < 0 ? 'overdue' : 'upcoming';

    [
      { role: 'borrower', user: borrower, counterpart: owner },
      { role: 'owner', user: owner, counterpart: borrower }
    ].forEach(({ role, user, counterpart }) => {
      if (!user || !counterpart) return;

      const newMsg = buildReminderMessage({
        borrow: b, role, status, daysDiff, instrument, user, counterpart
      });
      currentKeys.add(newMsg.uniqueKey);

      const existing = existingKeys.get(newMsg.uniqueKey);
      if (!existing) {
        messages.push(newMsg);
        newCount++;
      }
    });
  });

  const beforeCleanup = messages.length;
  messages = messages.filter(m => {
    if (!m.borrowId) return true;
    if (!borrowingSet.has(m.borrowId)) return false;
    if (!m.uniqueKey) return true;
    return currentKeys.has(m.uniqueKey);
  });
  const removedOutdated = beforeCleanup - messages.length;
  updatedCount = removedOutdated;

  writeJSON('messages.json', messages);

  return {
    generated: newCount,
    updated: updatedCount,
    removedStale,
    removedOutdated,
    total: messages.length
  };
}

router.post('/check', (req, res) => {
  const result = checkAndGenerateReminders();
  res.json({ success: true, ...result });
});

router.post('/cleanup/:borrowId', (req, res) => {
  const removed = cleanupRemindersByBorrowId(req.params.borrowId);
  res.json({ success: true, removed });
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

module.exports = { router, checkAndGenerateReminders, cleanupRemindersByBorrowId };
