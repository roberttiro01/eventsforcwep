const { pool } = require('./db');

function sanitize(org) {
  const o = org || {};
  return {
    bg: (o.bg || '').trim(),
    name: (o.name || o.text1 || '').trim(),
    role: (o.role || o.text2 || '').trim(),
  };
}

// Public: list active organizers
function listOrganizers(req, res) {
  const sql = 'SELECT id, name, role, bg, active FROM organizers WHERE active = 1 ORDER BY id';
  pool.query(sql, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to list organizers' });
    return res.json({ data: rows });
  });
}

// Admin: create organizer
function createOrganizer(req, res) {
  const { bg, name, role } = sanitize(req.body || {});
  if (!name) return res.status(400).json({ error: 'name is required' });
  const sql = 'INSERT INTO organizers (name, role, bg, active) VALUES (?, ?, ?, 1)';
  pool.query(sql, [name, role, bg], (err, result) => {
    if (err) return res.status(500).json({ error: 'Failed to create organizer' });
    return res.json({ success: true, id: result.insertId, data: { id: result.insertId, name, role, bg, active: 1 } });
  });
}

// Admin: update organizer by id
function updateOrganizer(req, res) {
  const id = parseInt(req.params.index, 10);
  if (isNaN(id) || id < 0) return res.status(400).json({ error: 'Invalid id' });
  const { bg, name, role } = sanitize(req.body || {});
  const sql = 'UPDATE organizers SET name = ?, role = ?, bg = ? WHERE id = ?';
  pool.query(sql, [name, role, bg, id], (err, result) => {
    if (err) return res.status(500).json({ error: 'Failed to update organizer' });
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Organizer not found' });
    return res.json({ success: true, id, data: { id, name, role, bg } });
  });
}

// Admin: soft delete organizer by id
function deleteOrganizer(req, res) {
  const id = parseInt(req.params.index, 10);
  if (isNaN(id) || id < 0) return res.status(400).json({ error: 'Invalid id' });
  const hard = String(req.query.hard || '').toLowerCase();
  const isHard = hard === '1' || hard === 'true' || hard === 'yes';
  const sql = isHard ? 'DELETE FROM organizers WHERE id = ?' : 'UPDATE organizers SET active = 0 WHERE id = ?';
  pool.query(sql, [id], (err, result) => {
    if (err) return res.status(500).json({ error: isHard ? 'Failed to hard delete organizer' : 'Failed to delete organizer' });
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Organizer not found' });
    return res.json({ success: true, hard: isHard });
  });
}

// Admin: soft delete by exact name (case-insensitive)
function deleteByName(req, res) {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  const hard = String(req.query.hard || '').toLowerCase();
  const isHard = hard === '1' || hard === 'true' || hard === 'yes';
  const sql = isHard ? 'DELETE FROM organizers WHERE LOWER(name) = LOWER(?)' : 'UPDATE organizers SET active = 0 WHERE LOWER(name) = LOWER(?)';
  pool.query(sql, [String(name).trim()], (err, result) => {
    if (err) return res.status(500).json({ error: isHard ? 'Failed to hard delete by name' : 'Failed to delete by name' });
    return res.json({ success: true, deleted: result.affectedRows, hard: isHard });
  });
}

module.exports = {
  listOrganizers,
  createOrganizer,
  updateOrganizer,
  deleteOrganizer,
  deleteByName,
};


