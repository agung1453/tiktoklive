import express from "express";
import { WebcastPushConnection } from "tiktok-live-connector";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let connection = null;
let clients = []; 
let foods = []; 
// 💡 PERBAIKAN: Pastikan variabel global ini dideklarasikan
let currentFoodPositions = new Set(); 
let snakePositions = new Set(); 

// ===================
// Konstanta Server
// ===================
const GAME_SIZE = 25; 
const TILE_SIZE = 25; // Dibuat statis di sini untuk perhitungan HTML
const MAX_FOODS = 20; 

// 💡 Hitung lebar canvas di server terlebih dahulu
const canvasWidth = GAME_SIZE * TILE_SIZE;
const canvasHeight = GAME_SIZE * TILE_SIZE;


// ===================
// Fungsi Utility Server
// ===================

/**
 * Mendapatkan posisi random yang belum ditempati oleh ular atau makanan lain.
 */
const getNewFoodPosition = () => {
    let randomPos = {};
    let posKey = '';
    let attempts = 0;
    
    do {
        randomPos = {
            x: Math.floor(Math.random() * GAME_SIZE),
            y: Math.floor(Math.random() * GAME_SIZE),
        };
        posKey = `${randomPos.x},${randomPos.y}`;
        attempts++;
        if (attempts > (GAME_SIZE * GAME_SIZE * 2)) return null; 
    } while (currentFoodPositions.has(posKey) || snakePositions.has(posKey));

    return randomPos;
};

/**
 * Mengirim data Avatar ke semua klien SSE yang terhubung.
 */
const pushAvatar = (avatarUrl) => {
    if (!avatarUrl || foods.length >= MAX_FOODS) return;

    const newPos = getNewFoodPosition();
    if (!newPos) return;

    const newFood = {
        ...newPos, 
        avatar: avatarUrl,
        spawnTime: Date.now(), 
    };

    const dataToSend = JSON.stringify(newFood);

    clients.forEach((client) => {
        client.write(`data: ${dataToSend}\n\n`);
    });
    
    foods.push(newFood);
    currentFoodPositions.add(`${newFood.x},${newFood.y}`);
};


// ===================
// Halaman utama (HTML & Logika Klien)
// ===================
app.get("/", (req, res) => {
  res.send(`
  <html>
  <head>
    <title>🐍 TikTok Live Snake Autopilot</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0; padding: 20px;
        display: flex; flex-direction: column; align-items: center;
        background: #ffffff; 
        color: #333;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        min-height: 100vh;
      }
      h2 { margin: 15px 0; color: #0af; }
      form { margin-bottom: 20px; display: flex; }
      input, button {
        padding: 10px 15px; border-radius: 8px; border: 1px solid #ccc; 
        font-size: 16px; margin: 0 5px;
      }
      button {
        background: #0af; color: white; font-weight: bold; cursor: pointer;
        border: none;
      }
      canvas {
        width: 100%;
        max-width: 500px;
        aspect-ratio: 1 / 1;
        border: 4px solid #0af;
        border-radius: 10px;
        background: #f8f8f8;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }
      #score { font-weight: bold; font-size: 1.2em; margin-bottom: 10px; }
    </style>
  </head>
  <body>
    <h2>🐍 TikTok Snake Autopilot</h2>
    <form method="POST" action="/connect">
      <input type="text" name="username" placeholder="Username Live TikTok" required>
      <button type="submit">Connect & Play</button>
    </form>
    <div id="score">Skor: 0</div>
    <canvas id="game" width="${canvasWidth}" height="${canvasHeight}"></canvas>

    <script>
      const canvas = document.getElementById("game");
      const ctx = canvas.getContext("2d");

      // Konstanta Klien (Hardcoded untuk stabilitas)
      const GAME_SIZE = ${GAME_SIZE}; 
      const TILE_SIZE = ${TILE_SIZE}; 
      const GAME_SPEED_MS = 150; 
      const SYSTEM_AVATAR_URL = 'https://cdn-icons-png.flaticon.com/512/25/25694.png';
      
      let width = GAME_SIZE * TILE_SIZE;
      let height = GAME_SIZE * TILE_SIZE;
      let size = TILE_SIZE;

      // Tidak perlu resizeCanvas karena canvas memiliki ukuran statis 
      // yang dihitung dari server, sehingga lebih stabil.

      let snake = [];
      let foods = [];
      let dir = "RIGHT";
      let score = 0;
      let lastUpdate = 0;
      let animationFrame;

      // Inisialisasi Game
      function initGame() {
        snake = [{ 
            x: Math.floor(GAME_SIZE / 2), 
            y: Math.floor(GAME_SIZE / 2), 
            img: null,
            prevX: Math.floor(GAME_SIZE / 2),
            prevY: Math.floor(GAME_SIZE / 2),
        }];
        foods = [];
        score = 0;
        document.getElementById("score").innerText = "Skor: 0";
        dir = "RIGHT";
        
        if (animationFrame) cancelAnimationFrame(animationFrame);
        lastUpdate = performance.now();
        gameLoop(lastUpdate);
      }
      initGame(); 

      // --- Inisialisasi Gambar Avatar (Cache) ---
      const imageCache = new Map();
      function getAvatarImage(url) {
          if (imageCache.has(url)) return imageCache.get(url);
          const img = new Image();
          img.crossOrigin = "Anonymous";
          img.src = url;
          imageCache.set(url, img);
          return img;
      }
      
      // --- EventSource TikTok (SSE) ---
      const events = new EventSource("/events");
      events.onmessage = (e) => {
        const newFoodData = JSON.parse(e.data);
        
        // Cek apakah posisi sudah ditempati ular atau makanan lain (Client-side safety)
        const isOccupied = snake.some(s => s.x === newFoodData.x && s.y === newFoodData.y) || 
                           foods.some(f => f.x === newFoodData.x && f.y === newFoodData.y);
        
        if (!isOccupied) {
          const food = {
            x: newFoodData.x,
            y: newFoodData.y,
            spawnTime: performance.now(), 
            img: getAvatarImage(newFoodData.avatar),
          };
          foods.push(food);
        }
      };

      // --- Autopilot Logic: Prioritas Avatar Tertua ---
      function getTargetFood(head) {
        if (foods.length === 0) return null;
        
        let oldestFood = null;
        let oldestTime = Infinity;

        foods.forEach(f => {
          if (f.spawnTime < oldestTime) {
            oldestTime = f.spawnTime;
            oldestFood = f;
          }
        });
        return oldestFood;
      }

      function updateGameLogic() {
        let head = { ...snake[0] };
        const target = getTargetFood(head);
        
        // 1. Tentukan Arah
        if (target) {
          const diffX = head.x - target.x;
          const diffY = head.y - target.y;
          let new_dx = 0;
          let new_dy = 0;

          if (Math.abs(diffX) > Math.abs(diffY)) {
             new_dx = diffX > 0 ? -1 : 1;
          } else {
             new_dy = diffY > 0 ? -1 : 1;
          }

          if ((new_dx === -dx && new_dy === -dy) && snake.length > 1) {
             if (dx !== 0) { 
                new_dx = 0; 
                new_dy = (head.y < target.y) ? 1 : -1;
             } else { 
                new_dx = (head.x < target.x) ? 1 : -1; 
                new_dy = 0;
             }
          }
          
          if (new_dx !== 0 || new_dy !== 0) {
              dir = new_dx === 1 ? "RIGHT" : new_dx === -1 ? "LEFT" : new_dy === 1 ? "DOWN" : "UP";
          }
        }

        // 2. Terapkan Pergerakan
        snake.forEach(s => { s.prevX = s.x; s.prevY = s.y; });

        if (dir === "UP") head.y--;
        if (dir === "DOWN") head.y++;
        if (dir === "LEFT") head.x--;
        if (dir === "RIGHT") head.x++;

        // Wrap-around
        if (head.x < 0) head.x = GAME_SIZE - 1;
        if (head.y < 0) head.y = GAME_SIZE - 1;
        if (head.x >= GAME_SIZE) head.x = 0;
        if (head.y >= GAME_SIZE) head.y = 0;

        // 3. Makan & Tumbuh
        let ate = false;
        let positionsToSend = [];
        
        for (let i = 0; i < foods.length; i++) {
          if (head.x === foods[i].x && head.y === foods[i].y) {
            head.img = foods[i].img;
            snake.unshift(head);
            foods.splice(i, 1);
            score++;
            document.getElementById("score").innerText = "Skor: " + score;
            ate = true;
            break;
          }
        }

        if (!ate) {
            snake.unshift(head);
            snake.pop();
        }
        
        // 4. Sinkronkan posisi ular ke server
        positionsToSend = snake.map(s => \`\${s.x},\${s.y}\`);

         fetch('/update-snake-position', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ 
                 positions: positionsToSend, 
                 // Kirim posisi makanan yang tersisa agar server tahu mana yang sudah dimakan
                 foods: foods.map(f => \`\${f.x},\${f.y}\`),
             })
         });
      }
      
      // --- Rendering Loop (Smooth) ---
      function gameLoop(timestamp) {
          const elapsed = timestamp - lastUpdate;
          
          if (elapsed > GAME_SPEED_MS) {
              updateGameLogic();
              lastUpdate = timestamp - (elapsed % GAME_SPEED_MS); 
          }

          let interpolationFactor = elapsed / GAME_SPEED_MS;
          if (interpolationFactor > 1) interpolationFactor = 1;

          drawGame(interpolationFactor);

          animationFrame = requestAnimationFrame(gameLoop);
      }
      
      function drawGame(t) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        
        // Gambar makanan (Avatar dengan fade-in)
        foods.forEach((f) => {
          const img = f.img;
          
          const age = performance.now() - f.spawnTime;
          let opacity = Math.min(1, age / 500); 

          ctx.save();
          ctx.globalAlpha = opacity; 
          
          if (img.complete) {
            ctx.drawImage(img, f.x * size, f.y * size, size, size);
          } else {
            ctx.fillStyle = "#ccc";
            ctx.fillRect(f.x * size, f.y * size, size, size);
          }
          ctx.restore();
        });

        // Gambar ular (Gerakan Halus)
        snake.forEach((s, i) => {
          const img = s.img;
          
          // Interpolasi posisi
          const x = s.prevX * size * (1 - t) + s.x * size * t;
          const y = s.prevY * size * (1 - t) + s.y * size * t;

          const padding = i === 0 ? 0 : 2; 
          const segmentSize = size - padding * 2;
          
          if (img && img.complete) {
            ctx.drawImage(img, x + padding, y + padding, segmentSize, segmentSize);
          } else {
            ctx.fillStyle = i === 0 ? '#0af' : '#555'; 
            ctx.fillRect(x, y, size, size);
          }
        });
      }

      gameLoop(performance.now());
    </script>
  </body>
  </html>
  `);
});

// -------------------
// Koneksi TikTok & SSE
// -------------------
app.post("/connect", async (req, res) => {
  const username = req.body.username?.trim();
  if (!username) return res.send("Username kosong!");

  // Reset koneksi dan status game server
  if (connection) connection.disconnect();
  foods = [];
  // 💡 PERBAIKAN: Reset semua Set global
  currentFoodPositions.clear(); 
  snakePositions.clear(); 

  connection = new WebcastPushConnection(username);

  try {
    await connection.connect();
    console.log("✅ Terhubung ke:", username);
  } catch (err) {
    console.error("❌ Error:", err);
    return res.send("Gagal konek ke TikTok!");
  }

  // Event yang menghasilkan makanan (Avatar)
  connection.on("chat", (d) => pushAvatar(d.profilePictureUrl));
  connection.on("like", (d) => pushAvatar(d.profilePictureUrl));
  connection.on("gift", (d) => pushAvatar(d.profilePictureUrl));
  connection.on("member", (d) => pushAvatar(d.profilePictureUrl));
  connection.on("follow", (d) => pushAvatar(d.profilePictureUrl));

  res.redirect("/");
});

// -------------------
// Event Stream (SSE)
// -------------------
app.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
  clients.push(res);
  req.on("close", () => {
    clients = clients.filter((c) => c !== res);
  });
});

// -------------------
// Route untuk menerima posisi ular dari client (untuk validasi server)
// -------------------
app.post("/update-snake-position", (req, res) => {
    // Memperbarui posisi ular
    snakePositions = new Set(req.body.positions);
    
    // 💡 PERBAIKAN: Sinkronkan posisi makanan yang tersisa dari klien
    // Hapus makanan yang sudah dimakan dari daftar foods server
    const clientFoodKeys = new Set(req.body.foods);
    
    foods = foods.filter(f => clientFoodKeys.has(`${f.x},${f.y}`));
    currentFoodPositions = clientFoodKeys;

    res.status(200).send({ status: 'ok' });
});

const PORT = 3000;
app.listen(PORT, () =>
  console.log(`🚀 TikTok Snake AutoBot aktif di http://localhost:${PORT}`)
);
