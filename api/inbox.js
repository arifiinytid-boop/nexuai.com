// api/inbox.js — NEXUS AI Inbox System v1.0
import { readFileSync, writeFileSync, existsSync } from 'fs';
const INBOX_FILE = '/tmp/nexus_inbox.json';
function getInbox() { try { if (existsSync(INBOX_FILE)) return JSON.parse(readFileSync(INBOX_FILE,'utf8')); } catch(_) {} return {}; }
function saveInbox(d) { try { writeFileSync(INBOX_FILE, JSON.stringify(d)); } catch(_) {} }
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method==='GET') {
    const user=(req.query.user||'').toLowerCase().trim();
    if (!user) return res.status(400).json({error:'user required'});
    const inbox=getInbox();
    const msgs=(inbox[user]||[]).sort((a,b)=>b.ts-a.ts);
    return res.status(200).json({messages:msgs, unread:msgs.filter(m=>!m.read).length});
  }
  if (req.method==='POST') {
    const {to, from, subject, content, type, sender_id}=req.body||{};
    if (!to||!content) return res.status(400).json({error:'to and content required'});
    const msg={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),to:to.toLowerCase(),from:from||'NEXUS AI',fromId:sender_id||'system',subject:subject||'Message from NEXUS AI',content:String(content).substring(0,5000),type:type||'general',ts:Date.now(),read:false};
    const inbox=getInbox();
    if (!inbox[to.toLowerCase()]) inbox[to.toLowerCase()]=[];
    inbox[to.toLowerCase()].unshift(msg);
    if (inbox[to.toLowerCase()].length>50) inbox[to.toLowerCase()]=inbox[to.toLowerCase()].slice(0,50);
    saveInbox(inbox);
    return res.status(200).json({status:'ok',id:msg.id});
  }
  if (req.method==='DELETE') {
    const {user, id, action}=req.body||{};
    if (!user) return res.status(400).json({error:'user required'});
    const inbox=getInbox();
    if (!inbox[user.toLowerCase()]) return res.status(200).json({status:'ok'});
    if (action==='read_all') inbox[user.toLowerCase()].forEach(m=>m.read=true);
    else if (id) {
      if (action==='delete') inbox[user.toLowerCase()]=inbox[user.toLowerCase()].filter(m=>m.id!==id);
      else { const msg=inbox[user.toLowerCase()].find(m=>m.id===id); if(msg) msg.read=true; }
    }
    saveInbox(inbox);
    return res.status(200).json({status:'ok'});
  }
  return res.status(405).json({error:'Method not allowed'});
}
