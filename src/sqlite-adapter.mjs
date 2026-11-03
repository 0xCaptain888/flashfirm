// D1-shaped adapter keeps the task-flow transaction logic identical locally.
export function sqliteAdapter(db){
  return {prepare(sql){let args=[];return {bind(...a){args=a;return this;},
    async first(){return db.prepare(sql).get(...args)??null;},
    async all(){return {results:db.prepare(sql).all(...args)};},
    async run(){const statement=db.prepare(sql);return statement.columns().length?
      {results:statement.all(...args),meta:{changes:0}}:{meta:{changes:statement.run(...args).changes}};}};},
  async batch(statements){db.exec('BEGIN IMMEDIATE');try{
    const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;
  }catch(e){db.exec('ROLLBACK');throw e;}}};
}
