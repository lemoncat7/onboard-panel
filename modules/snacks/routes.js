const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_PATH = path.join(DATA_DIR, 'food-data.json');
const IMAGES_DIR = path.join(__dirname, '..', '..', 'assets', 'food-images');
const ADDR_PATH = path.join(DATA_DIR, 'food-address.json');

function readData() {
  let data = { available: [], untried: [], blacklisted: [] };
  try { data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); } catch {}
  return data;
}
function writeData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function handle(req, res, url, urlPath, tools) {
  const { serveFile, json, runCmd } = tools;

  // === Food 图片上传 ===
  if (url.startsWith('/food-images/')) {
    const fileName = path.basename(url);
    const filePath = path.join(IMAGES_DIR, fileName);
    if (fs.existsSync(filePath)) {
      serveFile(res, filePath, 'image/png');
      return true;
    }
  }

  // === Food 静态页面 ===
  if (url === '/food' || url === '/food.html') {
    const foodPage = path.join(__dirname, 'index.html');
    // 如果 modules 下不存在，回退到 bak（删除后不再支持）
    const fallbackPage = path.join(__dirname, '..', '..', 'bak', 'food.html');
    if (fs.existsSync(foodPage)) {
      serveFile(res, foodPage, 'text/html');
      return true;
    } else if (fs.existsSync(fallbackPage)) {
      serveFile(res, fallbackPage, 'text/html');
      return true;
    }
  }

  // === Food API ===
  if (urlPath === '/api/food' && req.method === 'GET') {
    json(res, readData());
    return true;
  }

  if (urlPath === '/api/food/citycode' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { address } = JSON.parse(body);
        if (!address) { json(res, { success: false, error: '缺少地址' }, 400); return; }
        const geoUrl = 'https://restapi.amap.com/v3/geocode/geo?address=' + encodeURIComponent(address) + '&key=aaf986cafd1eaad6f231c4d17a021579';
        let geoData = {};
        try { geoData = JSON.parse(execSync('curl -s --http1.1 --connect-timeout 8 "' + geoUrl + '"').toString()); } catch {}
        const location = geoData?.geocodes?.[0]?.location;
        if (!location) { json(res, { success: false, error: '地址无法解析' }, 400); return; }
        const regeoUrl = 'https://restapi.amap.com/v3/geocode/regeo?key=aaf986cafd1eaad6f231c4d17a021579&location=' + location;
        let regeoData = {};
        try { regeoData = JSON.parse(execSync('curl -s --http1.1 --connect-timeout 8 "' + regeoUrl + '"').toString()); } catch {}
        const comp = regeoData?.regeocode?.addressComponent || {};
        json(res, { success: true, citycode: comp.citycode || '', city: comp.city || '', province: comp.province || '', district: comp.district || '', location });
      } catch (e) { json(res, { success: false, error: e.message }, 500); }
    });
    return true;
  }

  if (urlPath === '/api/food/search' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name, citycode } = JSON.parse(body);
        if (!name) { json(res, { success: false, error: '缺少店名' }, 400); return; }
        const cityParam = citycode ? '&city=' + encodeURIComponent(citycode) : '';
        const searchUrl = 'https://restapi.amap.com/v3/place/text?key=aaf986cafd1eaad6f231c4d17a021579&keywords=' + encodeURIComponent(name) + '&types=050000' + cityParam + '&offset=10&page=1&extensions=base';
        let searchData = {};
        try { searchData = JSON.parse(execSync('curl -s --http1.1 --connect-timeout 8 "' + searchUrl + '"').toString()); } catch {}
        const pois = (searchData?.pois || []).slice(0, 6).map(p => ({
          name: p.name, address: p.address || '', location: p.location || '',
          type: p.type?.replace(/^\d+_/, '').replace(/_/g, ',') || '',
          tel: p.tel || '', distance: p.distance || ''
        }));
        json(res, { success: true, count: pois.length, results: pois });
      } catch { json(res, { success: false, error: '搜索失败' }, 500); }
    });
    return true;
  }

  if (urlPath === '/api/food/parse' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { url: parseUrl } = JSON.parse(body);
        if (!parseUrl) { json(res, { success: false, error: '缺少链接' }, 400); return; }
        let name = '', address = '';
        try {
          const result = await runCmd(`curl -s -L -A "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15" --connect-timeout 8 --max-time 10 "${parseUrl.replace(/"/g, '')}" | grep -o '<title>[^<]*</title>' | head -1`);
          if (result.ok && result.stdout) {
            const title = result.stdout.replace(/<\/?title>/g, '').trim();
            if (title.includes('美团') || title.includes('饿了么')) {
              name = title.split('-')[0].trim();
            } else if (title && title !== '404' && title !== '出错啦' && title !== '验证中心') {
              name = title;
            }
          }
        } catch {}
        json(res, { success: true, data: { name, address, url: parseUrl } });
      } catch { json(res, { success: false, error: '解析失败' }, 400); }
    });
    return true;
  }

  if (urlPath === '/api/food' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const data = readData();
        if (d.action === 'add') {
          const item = { id: Date.now() + Math.random(), name: d.name, category: d.category || '', tags: d.tags || '', price: d.price || '', rating: d.rating || 0, address: d.address || '', image: d.image || '', note: d.note || '', url: d.url || '', addedAt: Date.now() };
          if (d.list === 'available') data.available.push(item);
          else if (d.list === 'untried') data.untried.push(item);
          else if (d.list === 'blacklisted') data.blacklisted.push(item);
          writeData(data);
          json(res, { success: true, item });
        } else if (d.action === 'remove') {
          if (d.list === 'available') data.available = data.available.filter(i => i.id != d.id);
          else if (d.list === 'untried') data.untried = data.untried.filter(i => i.id != d.id);
          else if (d.list === 'blacklisted') data.blacklisted = data.blacklisted.filter(i => i.id != d.id);
          writeData(data);
          json(res, { success: true });
        } else if (d.action === 'move') {
          const src = d.from === 'available' ? data.available : d.from === 'untried' ? data.untried : data.blacklisted;
          const tgt = d.to === 'available' ? data.available : d.to === 'untried' ? data.untried : data.blacklisted;
          const idx = src.findIndex(i => i.id == d.id);
          if (idx >= 0) { const [item] = src.splice(idx, 1); tgt.push(item); }
          writeData(data);
          json(res, { success: true });
        } else if (d.action === 'upload') {
          const imgData = d.image.split(',')[1];
          const ext = d.image.includes('image/png') ? 'png' : 'jpg';
          const fileName = Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + ext;
          ensureDir(IMAGES_DIR);
          const filePath = path.join(IMAGES_DIR, fileName);
          fs.writeFileSync(filePath, Buffer.from(imgData, 'base64'));
          json(res, { success: true, url: '/food-images/' + fileName });
        } else if (d.action === 'random') {
          const { pick, extra } = (() => {
            if (!data.available.length && !data.untried.length) return { pick: null, extra: null };
            const pickList = d.newShop ? [...data.untried] : [...data.available];
            if (!pickList.length) return { pick: null, extra: null };
            const picked = pickList[Math.floor(Math.random() * pickList.length)];
            const other = d.newShop && data.available.length ? data.available[Math.floor(Math.random() * data.available.length)] : null;
            return { pick: picked, extra: other };
          })();
          json(res, { success: true, pick, extra });
        } else if (d.action === 'update') {
          const list = d.list === 'available' ? data.available : d.list === 'untried' ? data.untried : data.blacklisted;
          const idx = list.findIndex(i => i.id == d.id);
          if (idx >= 0) {
            const item = list[idx];
            ['name','category','tags','price','rating','address','image','note','url'].forEach(k => {
              if (d[k] !== undefined) item[k] = d[k];
            });
            writeData(data);
            json(res, { success: true, item });
          } else {
            json(res, { success: false, error: 'not found' }, 404);
          }
        } else if (d.action === 'discover') {
          const address = (d.address || '').trim();
          if (!address) { json(res, { success: false, error: '请提供地址' }, 400); return; }
          const geoUrl = 'https://restapi.amap.com/v3/geocode/geo?address=' + encodeURIComponent(address) + '&key=aaf986cafd1eaad6f231c4d17a021579';
          let geoData = {};
          try { geoData = JSON.parse(execSync('curl -s --http1.1 --connect-timeout 8 "' + geoUrl + '"').toString()); } catch {}
          const location = geoData?.geocodes?.[0]?.location;
          if (!location) { json(res, { success: false, error: '地址无法解析，请在地图上确认' }); return; }
          const [lng, lat] = location.split(',');
          const radius = d.radius || 2000;
          const poiUrl = 'https://restapi.amap.com/v3/place/around?key=aaf986cafd1eaad6f231c4d17a021579&location=' + location + '&keywords=餐饮,餐厅,美食&types=050000&radius=' + radius + '&offset=20&page=1&extensions=base';
          let poiData = {};
          try { poiData = JSON.parse(execSync('curl -s --http1.1 --connect-timeout 8 "' + poiUrl + '"').toString()); } catch {}
          const existingNames = new Set([...data.available, ...data.untried].map(i => i.name));
          const newShops = (poiData?.pois || []).filter(p => !existingNames.has(p.name)).slice(0, 10);
          const items = newShops.map(p => ({
            id: Date.now() + Math.random(), name: p.name,
            category: p.type?.replace(/^\d+_/, '').replace(/_/g, ',') || '', tags: '', price: '', rating: 0,
            address: p.address || '', image: '', note: '', addedAt: Date.now(), location: p.location || '', fromMap: true
          }));
          json(res, { success: true, items, total: newShops.length, location: { lng, lat }, address });
        } else if (d.action === 'setAddress') {
          fs.writeFileSync(ADDR_PATH, JSON.stringify({ address: d.address, updatedAt: Date.now() }));
          json(res, { success: true });
        } else if (d.action === 'getAddress') {
          let addr = '';
          try { addr = JSON.parse(fs.readFileSync(ADDR_PATH, 'utf8')).address || ''; } catch {}
          json(res, { success: true, address: addr });
        } else if (d.action === 'saveDiscovered') {
          const items = d.items || [];
          const list = d.list || 'untried';
          for (const item of items) {
            if (list === 'available') data.available.push(item);
            else data.untried.push(item);
          }
          writeData(data);
          json(res, { success: true, count: items.length });
        } else {
          json(res, { success: false, error: 'unknown action' }, 400);
        }
      } catch (e) { json(res, { success: false, error: e.message }, 400); }
    });
    return true;
  }

  return false;
}

module.exports = { handle };
