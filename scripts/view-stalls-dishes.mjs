import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const dbPath = resolve(import.meta.dirname || '.', '..', 'data', 'smart-canteen.sqlite');
const db = new DatabaseSync(dbPath);

const stalls = db.prepare('SELECT id, name, category, floor FROM stalls ORDER BY category, name').all();
const dishes = db.prepare('SELECT id, stall_id, name, dish_type, dish_category, meal_period, price FROM dishes ORDER BY stall_id, name').all();

const dishesByStall = {};
dishes.forEach(d => {
  if (!dishesByStall[d.stall_id]) dishesByStall[d.stall_id] = [];
  dishesByStall[d.stall_id].push(d);
});

const stallRows = stalls.map(s => {
  const dishList = dishesByStall[s.id] || [];
  const typeBreakdown = {};
  const catBreakdown = {};
  dishList.forEach(d => {
    typeBreakdown[d.dish_type] = (typeBreakdown[d.dish_type] || 0) + 1;
    catBreakdown[d.dish_category] = (catBreakdown[d.dish_category] || 0) + 1;
  });
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    floor: s.floor,
    dishCount: dishList.length,
    dishes: dishList,
    typeBreakdown: Object.entries(typeBreakdown).map(([k,v]) => `${k}×${v}`).join(', '),
    catBreakdown: Object.entries(catBreakdown).sort((a,b) => b[1]-a[1]).map(([k,v]) => `${k}×${v}`).join(', ')
  };
});

const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>档口-菜品 关联视图</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Microsoft YaHei', sans-serif; background:#f5f5f5; padding:20px; }
h1 { text-align:center; margin-bottom:16px; color:#333; }
.summary { text-align:center; color:#666; margin-bottom:20px; }
.controls { display:flex; justify-content:center; gap:10px; margin-bottom:20px; flex-wrap:wrap; }
.controls input, .controls select { padding:8px 12px; border:1px solid #ccc; border-radius:6px; font-size:14px; }
.controls input { width:260px; }
.stall-card { background:#fff; border-radius:8px; margin-bottom:8px; box-shadow:0 1px 3px rgba(0,0,0,0.1); overflow:hidden; }
.stall-header { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; cursor:pointer; user-select:none; transition:background .15s; }
.stall-header:hover { background:#f0f7ff; }
.stall-name { font-weight:bold; font-size:15px; color:#222; }
.stall-meta { color:#888; font-size:13px; }
.stall-badge { display:inline-block; padding:2px 10px; border-radius:12px; font-size:12px; font-weight:bold; }
.stall-badge.meal { background:#e8f5e9; color:#2e7d32; }
.stall-badge.empty { background:#fafafa; color:#999; }
.stall-body { display:none; border-top:1px solid #eee; }
.stall-body.open { display:block; }
.dish-table { width:100%; border-collapse:collapse; font-size:13px; }
.dish-table th { background:#f9f9f9; padding:8px 12px; text-align:left; color:#666; border-bottom:2px solid #eee; position:sticky; top:0; }
.dish-table td { padding:7px 12px; border-bottom:1px solid #f0f0f0; white-space:nowrap; }
.dish-table tr:hover td { background:#fafbff; }
.tag { display:inline-block; padding:1px 8px; border-radius:10px; font-size:11px; margin-right:2px; }
.tag-type { background:#e3f2fd; color:#1565c0; }
.tag-cat { background:#fff3e0; color:#e65100; }
.tag-meal { background:#f3e5f5; color:#7b1fa2; }
.empty-hint { padding:16px; text-align:center; color:#bbb; }
.stall-cats { color:#999; font-size:12px; margin-left:8px; }
</style>
</head>
<body>
<h1>档口 → 菜品 关联视图</h1>
<p class="summary">共 <strong>${stalls.length}</strong> 个档口，<strong>${dishes.length}</strong> 道菜品</p>
<div class="controls">
  <input type="text" id="search" placeholder="搜索档口或菜品名..." oninput="filter()">
  <select id="typeFilter" onchange="filter()">
    <option value="">全部类型</option>
    <option value="餐食">餐食</option>
    <option value="小吃">小吃</option>
    <option value="饮品">饮品</option>
    <option value="加购">加购</option>
  </select>
  <select id="catFilter" onchange="filter()">
    <option value="">全部分类</option>
    ${[...new Set(dishes.map(d => d.dish_category).filter(Boolean))].sort().map(c => `<option value="${c}">${c}</option>`).join('')}
  </select>
</div>
<div id="stallList"></div>

<script>
const data = ${JSON.stringify(stallRows, null, 2)};
const list = document.getElementById('stallList');

function render(items) {
  list.innerHTML = items.map(s => {
    const catTags = s.dishCount > 0 ? s.catBreakdown.split(', ').slice(0,3).map(t => '<span style="font-size:11px;color:#999;margin-left:4px">' + t + '</span>').join('') : '';
    return '<div class="stall-card" data-name="' + s.name.toLowerCase() + '">' +
      '<div class="stall-header" onclick="toggle(this)">' +
        '<div><span class="stall-name">' + s.name + '</span>' + catTags + '</div>' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
          '<span class="stall-badge ' + (s.dishCount > 0 ? 'meal' : 'empty') + '">' + s.dishCount + ' 菜品</span>' +
          '<span class="stall-meta">' + (s.floor || '未知楼层') + ' · ' + s.category + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="stall-body">' +
        (s.dishCount === 0 ? '<div class="empty-hint">暂无菜品</div>' :
        '<table class="dish-table"><thead><tr>' +
        '<th>菜品名</th><th>类型</th><th>分类</th><th>餐次</th><th>价格</th>' +
        '</tr></thead><tbody>' +
        s.dishes.map(d => '<tr>' +
          '<td>' + d.name + '</td>' +
          '<td><span class="tag tag-type">' + d.dish_type + '</span></td>' +
          '<td><span class="tag tag-cat">' + d.dish_category + '</span></td>' +
          '<td><span class="tag tag-meal">' + d.meal_period + '</span></td>' +
          '<td>¥' + Number(d.price).toFixed(1) + '</td>' +
        '</tr>').join('') +
        '</tbody></table>') +
      '</div>' +
    '</div>';
  }).join('');
}

function toggle(header) {
  const body = header.nextElementSibling;
  body.classList.toggle('open');
}

function filter() {
  const keyword = document.getElementById('search').value.toLowerCase();
  const type = document.getElementById('typeFilter').value;
  const cat = document.getElementById('catFilter').value;
  const filtered = data.filter(s => {
    if (keyword && !s.name.toLowerCase().includes(keyword) && !s.dishes.some(d => d.name.toLowerCase().includes(keyword) || d.dish_category.toLowerCase().includes(keyword))) return false;
    if (type && !s.dishes.some(d => d.dish_type === type)) return false;
    if (cat && !s.dishes.some(d => d.dish_category === cat)) return false;
    return true;
  });
  render(filtered);
}

render(data);
</script>
</body>
</html>`;

const outPath = resolve(import.meta.dirname || '.', '..', 'stalls-dishes-view.html');
writeFileSync(outPath, html, 'utf-8');
console.log('HTML file written to:', outPath);
console.log('Stalls:', stalls.length, 'Dishes:', dishes.length);
db.close();
