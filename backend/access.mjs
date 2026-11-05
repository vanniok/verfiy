import {requireValue as need} from './core.mjs';

const resources={document:'documents',conversion:'conversions',comparison:'comparisons'};
const labels={customer:{Operator:'Customer operator',Reviewer:'Customer reviewer'},supplier:{Operator:'Supplier operator',Reviewer:'Supplier reviewer'}};

export class Access {
  constructor(store){
    this.s=store;
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS organization_types(tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),kind TEXT NOT NULL CHECK(kind IN ('customer','supplier')));
      CREATE TABLE IF NOT EXISTS personnel_reviewers(owner_id TEXT PRIMARY KEY REFERENCES users(id),reviewer_id TEXT NOT NULL REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS resource_access(kind TEXT NOT NULL,resource_id TEXT NOT NULL,tenant_id TEXT NOT NULL REFERENCES tenants(id),owner_id TEXT NOT NULL REFERENCES users(id),reviewer_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(kind,resource_id));
      CREATE INDEX IF NOT EXISTS resource_access_person ON resource_access(tenant_id,owner_id,reviewer_id);
    `);
    store.transaction(()=>{
      store.run("INSERT OR IGNORE INTO organization_types VALUES ('atlas','customer')");
      store.run("INSERT OR IGNORE INTO organization_types VALUES ('northstar','supplier')");
      for(const [kind,table] of Object.entries(resources)){
        for(const row of store.all(`SELECT r.* FROM ${table} r WHERE NOT EXISTS(SELECT 1 FROM resource_access a WHERE a.kind=? AND a.resource_id=r.id)`,kind)){
          const owner=store.get('SELECT * FROM users WHERE id=?',row.created_by);
          if(owner)this.add(kind,row.id,owner);
        }
      }
    });
  }
  person(user){
    const kind=this.s.get('SELECT kind FROM organization_types WHERE tenant_id=?',user.tenant_id)?.kind;
    need(kind&&labels[kind][user.role],403,'This account has no configured business role.');
    const operator=user.role==='Operator';
    return {...user,organization_type:kind,business_role:labels[kind][user.role],portal:kind+'-'+user.role.toLowerCase(),capabilities:{upload:operator,edit:operator,compare:operator,submit:operator,review:!operator,audit:!operator}};
  }
  reviewer(owner){
    const preference=this.s.get('SELECT reviewer_id FROM personnel_reviewers WHERE owner_id=?',owner.id);
    const user=preference?this.s.get("SELECT * FROM users WHERE id=? AND tenant_id=? AND role='Reviewer'",preference.reviewer_id,owner.tenant_id):this.s.get("SELECT * FROM users WHERE tenant_id=? AND role='Reviewer' ORDER BY id LIMIT 1",owner.tenant_id);
    need(user&&user.id!==owner.id,409,'Choose a reviewer from your organization before creating a record.');
    return user;
  }
  add(kind,id,owner){
    need(Object.hasOwn(resources,kind),400,'Unknown resource type.');
    const reviewer=this.reviewer(owner);
    this.s.run('INSERT OR IGNORE INTO resource_access VALUES (?,?,?,?,?)',kind,id,owner.tenant_id,owner.id,reviewer.id);
  }
  can(kind,id,actor){
    if(!Object.hasOwn(resources,kind)||!['Operator','Reviewer'].includes(actor.role))return false;
    const key=actor.role==='Operator'?'owner_id':'reviewer_id';
    return Boolean(this.s.get(`SELECT 1 FROM resource_access WHERE kind=? AND resource_id=? AND tenant_id=? AND ${key}=?`,kind,id,actor.tenant_id,actor.id));
  }
  list(kind,actor){
    need(Object.hasOwn(resources,kind),400,'Unknown resource type.');
    const key=actor.role==='Operator'?'owner_id':'reviewer_id';
    return this.s.all(`SELECT r.* FROM ${resources[kind]} r JOIN resource_access a ON a.resource_id=r.id AND a.kind=? WHERE r.tenant_id=? AND a.tenant_id=? AND a.${key}=? ORDER BY r.updated_at DESC,r.rowid DESC`,kind,actor.tenant_id,actor.tenant_id,actor.id);
  }
  sameReviewer(comparison,file){
    const a=this.s.get("SELECT reviewer_id FROM resource_access WHERE kind='comparison' AND resource_id=?",comparison.id);
    const b=this.s.get("SELECT reviewer_id FROM resource_access WHERE kind='conversion' AND resource_id=?",file.id);
    need(a?.reviewer_id&&a.reviewer_id===b?.reviewer_id,409,'These files belong to a different reviewer. Choose files assigned to this comparison reviewer.');
  }
  assigned(kind,id){
    return this.s.get('SELECT a.owner_id,a.reviewer_id,u.name AS reviewer_name FROM resource_access a JOIN users u ON u.id=a.reviewer_id WHERE kind=? AND resource_id=?',kind,id);
  }
  team(actor){return this.s.all("SELECT id,name,email FROM users WHERE tenant_id=? AND role='Reviewer' ORDER BY name,id",actor.tenant_id);}
  setReviewer(actor,id){
    need(actor.role==='Operator',403,'Only an operator can choose their reviewer.');
    need(this.team(actor).some(u=>u.id===id),400,'Choose a reviewer from your organization.');
    this.s.run('INSERT INTO personnel_reviewers VALUES (?,?) ON CONFLICT(owner_id) DO UPDATE SET reviewer_id=excluded.reviewer_id',actor.id,id);
    return this.reviewer(actor);
  }
}
