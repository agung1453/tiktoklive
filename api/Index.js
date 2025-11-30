import express from 'express';
import cors from 'cors';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// lowdb di Vercel harus pakai /tmp karena filesystem read-only
const file = join(__dirname, '..', 'db.json');
const adapter = new JSONFile(file);
const db = new Low(adapter);

await db.read();
db.data ||= { items: [] };
await db.write();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

// GET semua
app.get('/api', async (req, res) => {
  await db.read();
  res.json(db.data);
});

// CREATE
app.post('/api', async (req, res) => {
  await db.read();
  const { name } = req.body;
  const newItem = {
    id: Date.now(),
    name,
    done: false
  };
  db.data.items.push(newItem);
  await db.write();
  res.json(newItem);
});

// TOGGLE DONE
app.patch('/api/:id/toggle', async (req, res) => {
  await db.read();
  const item = db.data.items.find(i => i.id == req.params.id);
  if (item) {
    item.done = !item.done;
    await db.write();
    res.json(item);
  } else {
    res.status(404).json({ error: 'not found' });
  }
});

// DELETE
app.delete('/api/:id', async (req, res) => {
  await db.read();
  db.data.items = db.data.items.filter(i => i.id != req.params.id);
  await db.write();
  res.json({ success: true });
});

export default app;