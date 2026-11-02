// Injectable adapter: keep the network and explicit wallet approval invariant.
export function meteorAdapter(client, actionCreators) {
  const target = { blockchain: 'near', network: 'testnet' };
  async function current() {
    const account = await client.getAccount(target);
    if (account && (account.identifier.network !== 'testnet' || account.identifier.blockchain !== 'near')) throw Error('Meteor returned the wrong network');
    return account;
  }
  async function run(id, input) {
    return (await client.createAction({ id, input })).promptForExecution();
  }
  return {
    async signSetup() {
      throw Error('Meteor blocks Full Access Key requests. Account setup is disabled; do not retry this flow.');
    },
    async getAccounts() { const a = await current(); return a ? [{ accountId: a.identifier.accountId }] : []; },
    async signIn() { await run('near::sign_in', { target }); await current(); },
    async signOut() { const a = await current(); if (a) await run('near::sign_out', { target: a.identifier }); },
    async signAndSendTransaction(tx) {
      const a = await current();
      if (!a || a.identifier.accountId !== tx.signerId) throw Error('Meteor account changed; reconnect and prepare again');
      const actions = tx.actions.map(action => {
        if (action.type !== 'FunctionCall') throw Error('Only treasury function calls are supported');
        const p = action.params;
        return actionCreators.functionCall(p.methodName, p.args, BigInt(p.gas), BigInt(p.deposit));
      });
      const outcomes = await run('near::sign_transactions', {
        target: a.identifier, useFunctionCallKey: false,
        transactions: [{ receiverId: tx.receiverId, actions }]
      });
      if (!Array.isArray(outcomes) || outcomes.length !== 1) throw Error('Unexpected wallet result; inspect wallet history before retrying');
      return outcomes[0];
    }
  };
}
