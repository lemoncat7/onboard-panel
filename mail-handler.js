// mail handler for onboard-panel
// GET  /api/mail/list?mbox=inbox&limit=20
// POST /api/mail/send  {to, subject, body}

const { execSync, exec } = require('child_process');
const READ_SCRIPT = '/home/root/.openclaw/workspace/.agents/skills/stalwart-mail/scripts/read-mail.py';
const SEND_SCRIPT = '/home/root/.openclaw/workspace/.agents/skills/stalwart-mail/scripts/send-mail.py';
const JMAP = 'http://stalwart-mail:8080/jmap';
const KEY = 'API_AAAAAgAAAAGs5mA4gngpiCbR4no7p6PiLwQ68Q';
const ACCOUNT = 'c';
const FROM = 'moshang@mochencloud.cn';

function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function run(script, args, timeout = 20000) {
  const env = Object.assign({}, process.env, {
    STALWART_API_KEY: KEY,
    STALWART_JMAP_URL: JMAP,
    STALWART_ACCOUNT_ID: ACCOUNT
  });
  try {
    const out = execSync(`python3 "${script}" ${args.join(' ')}`, { env, timeout });
    return [true, out.toString().trim()];
  } catch (e) {
    return [false, e.message];
  }
}

module.exports = function(req, res, urlPath) {
  const path = urlPath.split('?')[0];

  // GET /api/mail/list
  if (req.method === 'GET' && path === '/api/mail/list') {
    const q = new URL(req.url, 'http://x');
    const mbox = q.searchParams.get('mbox') || 'inbox';
    const limit = q.searchParams.get('limit') || '20';
    const [ok, out] = run(READ_SCRIPT, [mbox, limit, '--all']);
    if (!ok) { json(res, { list: [], unread: 0, error: ok }, 500); return true; }
    // parse: blocks of [id, emoji+subject, from, preview]
    const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
    const emails = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.startsWith('未读') || line.startsWith('📭') || line.includes('NO_REPORT_NEED')) continue;
      // ID line followed by emoji line
      if (i + 1 < lines.length && (lines[i + 1].startsWith('🔴') || lines[i + 1].startsWith('✅'))) {
        const id = line.trim();
        i++;
        const emojiLine = lines[i];
        const seen = emojiLine.startsWith('✅');
        const subject = emojiLine.slice(2).trim();
        const from2 = lines[i + 1] ? lines[i + 1].replace('来自:', '').trim() : '';
        const preview = lines[i + 2] ? lines[i + 2].replace('摘要:', '').substring(0, 80) : '';
        emails.push({ id, subject, from: from2, preview, seen });
        i += 2;
      }
    }
    const unread = emails.filter(e => !e.seen).length;
    json(res, { list: emails, unread });
    return true;
  }

  // GET /api/mail/view
  if (req.method === 'GET' && path === '/api/mail/view') {
    const q = new URL(req.url, 'http://x');
    const id = q.searchParams.get('id');
    const mbox = q.searchParams.get('mbox') || 'inbox';
    if (!id) { json(res, {error:'id required'}, 400); return true; }
    const env = Object.assign({}, process.env, {STALWART_API_KEY:KEY, STALWART_JMAP_URL:JMAP, STALWART_ACCOUNT_ID:ACCOUNT});
    exec(`python3 -c "
import sys, json, urllib.request, os
J=os.getenv('STALWART_JMAP_URL','${JMAP}')
K=os.getenv('STALWART_API_KEY','')
A=os.getenv('STALWART_ACCOUNT_ID','c')
req=urllib.request.Request(J,method='POST',headers={'Authorization':'Bearer '+K,'Content-Type':'application/json'},data=json.dumps({'using':['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail'],'methodCalls':[['Email/get',{'accountId':A,'ids':['${id}'],'properties':['id','from','subject','receivedAt','preview','keywords','bodyValues'],'fetchAllBodyValues':True},'0']]}).encode())
with urllib.request.urlopen(req,timeout=30) as r: d=json.loads(r.read())
m=d['methodResponses'][0][1]['list'][0]
sender=m.get('from',[{}])[0]
print(json.dumps({'id':m['id'],'subject':m.get('subject',''),'from':sender.get('email',''),'from_name':sender.get('name',''),'date':m.get('receivedAt',''),'preview':m.get('preview',''),'seen':'$seen' in m.get('keywords',[]),'body': list(m.get('bodyValues',{}).values())[0].get('value','') if m.get('bodyValues',{}) else ''},ensure_ascii=False))
"`, {env, timeout:20000}, (err,stdout,stderr)=>{
      if(err){json(res,{error:stderr||err.message},500);}else{json(res,JSON.parse(stdout));}
    });
    return true;
  }

  // POST /api/mail/read
  if (req.method === 'POST' && path === '/api/mail/read') {
    const q = new URL(req.url, 'http://x');
    const id = q.searchParams.get('id');
    if (!id) { json(res, {success:false,error:'id required'}, 400); return true; }
    const env = Object.assign({}, process.env, {STALWART_API_KEY:KEY, STALWART_JMAP_URL:JMAP, STALWART_ACCOUNT_ID:ACCOUNT});
    exec(`python3 -c "
import json, urllib.request, os
J=os.getenv('STALWART_JMAP_URL','${JMAP}')
K=os.getenv('STALWART_API_KEY','')
A=os.getenv('STALWART_ACCOUNT_ID','c')
req=urllib.request.Request(J,method='POST',headers={'Authorization':'Bearer '+K,'Content-Type':'application/json'},data=json.dumps({'using':['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail'],'methodCalls':[['Email/set',{'accountId':A,'update':{'${id}':{'keywords':{'\$seen':True}}}},'0']]}).encode())
with urllib.request.urlopen(req,timeout=30) as r: d=json.loads(r.read())
print(json.dumps({'success':True}))
"`, {env, timeout:20000}, (err,stdout,stderr)=>{
      if(err){json(res,{success:false,error:stderr||err.message},500);}else{json(res,{success:true});}
    });
    return true;
  }

  // POST /api/mail/send
  if (req.method === 'POST' && path === '/api/mail/send') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { to, subject, body: msgBody } = JSON.parse(body);
        if (!to || !subject) { json(res, { success: false, error: 'to and subject required' }, 400); return; }
        const env = Object.assign({}, process.env, {
          STALWART_API_KEY: KEY, STALWART_JMAP_URL: JMAP, STALWART_ACCOUNT_ID: ACCOUNT, STALWART_FROM: FROM
        });
        const safe = s => String(s || '').replace(/"/g, '\\"');
        exec(`python3 "${SEND_SCRIPT}" "${safe(to)}" "${safe(subject)}" "${safe(msgBody || '')}"`, { env, timeout: 30000 }, (err, stdout, stderr) => {
          if (err) { json(res, { success: false, error: stderr || err.message }, 500); }
          else { json(res, { success: true }); }
        });
      } catch (e) { json(res, { success: false, error: e.message }, 500); }
    });
    return true;
  }

  return false;
};
