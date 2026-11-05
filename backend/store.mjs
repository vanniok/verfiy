import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {privatePath} from './resources.mjs';
import {ACCOUNTS,DEMO_PASSWORD,passwordHash,now,json} from './core.mjs';

const SCHEMA=`
CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,tenant_id TEXT NOT NULL REFERENCES tenants(id),role TEXT NOT NULL,password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS orders(tenant_id TEXT NOT NULL REFERENCES tenants(id),po TEXT NOT NULL,supplier TEXT NOT NULL,part TEXT NOT NULL,ordered INTEGER NOT NULL,received INTEGER NOT NULL,PRIMARY KEY(tenant_id,po));
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,created_by TEXT NOT NULL,filename TEXT NOT NULL,file_path TEXT NOT NULL,mime TEXT NOT NULL,sha256 TEXT NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,fields TEXT NOT NULL DEFAULT '{}',extraction TEXT NOT NULL DEFAULT '{}',verification TEXT NOT NULL DEFAULT '{}',error TEXT,review TEXT,report_path TEXT,report_sha256 TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS documents_tenant ON documents(tenant_id,created_at);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),status TEXT NOT NULL,attempt INTEGER NOT NULL,created_at TEXT NOT NULL,error TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON jobs(document_id) WHERE status IN ('pending','running');
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,document_id TEXT NOT NULL REFERENCES documents(id),tenant_id TEXT NOT NULL,action TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL,details TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS immutable_audit_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Audit records are append-only'); END;
CREATE TRIGGER IF NOT EXISTS immutable_audit_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit records are append-only'); END;
CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY AUTOINCREMENT,document_id TEXT NOT NULL REFERENCES documents(id),actor_id TEXT NOT NULL,decision TEXT NOT NULL,reason TEXT NOT NULL,at TEXT NOT NULL,snapshot TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS immutable_review_update BEFORE UPDATE ON reviews BEGIN SELECT RAISE(ABORT,'Review records are append-only'); END;
CREATE TRIGGER IF NOT EXISTS immutable_review_delete BEFORE DELETE ON reviews BEGIN SELECT RAISE(ABORT,'Review records are append-only'); END;
CREATE TABLE IF NOT EXISTS requests(user_id TEXT NOT NULL,request_key TEXT NOT NULL,method TEXT NOT NULL,path TEXT NOT NULL,digest TEXT NOT NULL,status INTEGER NOT NULL,response TEXT NOT NULL,PRIMARY KEY(user_id,request_key));`;

export class Store{
  constructor(root){this.root=privatePath(root);for(const part of ['uploads','reports','verification.sqlite3','verification.sqlite3-wal','verification.sqlite3-shm'])privatePath(root,part);fs.mkdirSync(root,{recursive:true});for(const folder of ['uploads','reports'])fs.mkdirSync(path.join(root,folder),{recursive:true});this.db=new DatabaseSync(path.join(root,'verification.sqlite3'));this.db.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=20000;');this.db.exec(SCHEMA);this.transaction(()=>{for(const [id,name]of[['atlas','Atlas Components'],['northstar','Northstar Supply']]){this.run('INSERT OR IGNORE INTO tenants VALUES (?,?)',id,name);this.run('INSERT OR IGNORE INTO orders VALUES (?,?,?,?,?,?)',id,'PO-2026-105','Meridian Parts Ltd.','P-1008',1000,200);this.run('INSERT OR IGNORE INTO orders VALUES (?,?,?,?,?,?)',id,'PO-2026-106','Harbor Industrial','P-2012',500,100);}for(const account of ACCOUNTS){if(!this.get('SELECT 1 FROM users WHERE id=?',account[0]))this.run('INSERT INTO users VALUES (?,?,?,?,?,?)',...account,passwordHash(DEMO_PASSWORD));}});}
  get(sql,...args){return this.db.prepare(sql).get(...args);}
  all(sql,...args){return this.db.prepare(sql).all(...args);}
  run(sql,...args){return this.db.prepare(sql).run(...args);}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  event(document,action,actor,details={}){this.run('INSERT INTO audit(document_id,tenant_id,action,actor_id,actor_name,at,details) VALUES (?,?,?,?,?,?,?)',document.id,document.tenant_id,action,actor.id,actor.name,now(),json(details));}
  transition(document,state,actor,details={}){this.run('UPDATE documents SET state=?,version=version+1,updated_at=? WHERE id=?',state,now(),document.id);this.event(document,'STATE_CHANGED',actor,{from:document.state,to:state,...details});return this.get('SELECT * FROM documents WHERE id=?',document.id);}
  enqueue(documentId,attempt,id){this.run("INSERT INTO jobs VALUES (?,?,'pending',?,?,NULL)",id,documentId,attempt,now());}
  close(){this.db.close();}
}
