'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('wallet_txs', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      wallet_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'wallets', key: 'id' } },
      funding_tx_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'funding_transactions', key: 'id' } },
      type: { type: Sequelize.STRING(16), allowNull: false },
      // Signed: credits positive, debits negative. SUM(amount) per wallet == wallet.balance.
      amount: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      balance_after: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    const q = (sql) => queryInterface.sequelize.query(sql);
    await q(`ALTER TABLE wallet_txs ADD CONSTRAINT wtx_type_chk CHECK (type IN ('deposit','wager','withdrawal'))`);
    await q(`ALTER TABLE wallet_txs ADD CONSTRAINT wtx_amount_nonzero_chk CHECK (amount <> 0)`);
    // A funding transaction can produce at most one ledger entry of a given type.
    await q(`CREATE UNIQUE INDEX wallet_txs_funding_tx_type_uniq
             ON wallet_txs (funding_tx_id, type) WHERE funding_tx_id IS NOT NULL`);
    await q(`CREATE INDEX wallet_txs_wallet_created_idx ON wallet_txs (wallet_id, created_at)`);

    // Append-only: reject UPDATE and DELETE at the database level.
    await q(`CREATE FUNCTION wallet_txs_immutable() RETURNS trigger AS $$
             BEGIN RAISE EXCEPTION 'wallet_txs is append-only'; END;
             $$ LANGUAGE plpgsql`);
    await q(`CREATE TRIGGER wallet_txs_no_update_delete
             BEFORE UPDATE OR DELETE ON wallet_txs
             FOR EACH ROW EXECUTE FUNCTION wallet_txs_immutable()`);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('wallet_txs');
    await queryInterface.sequelize.query('DROP FUNCTION IF EXISTS wallet_txs_immutable()');
  },
};