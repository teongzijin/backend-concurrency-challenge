'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('funding_transactions', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      member_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'members', key: 'id' } },
      wallet_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'wallets', key: 'id' } },
      type: { type: Sequelize.STRING(16), allowNull: false },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'pending' },
      amount: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      turnover_multiplier: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      // Only deposits have a pspRef. Postgres allows many NULLs in a unique column.
      psp_ref: { type: Sequelize.STRING, allowNull: true, unique: true },
      psp_reported_amount: { type: Sequelize.DECIMAL(36, 18), allowNull: true },
      failure_reason: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    const q = (sql) => queryInterface.sequelize.query(sql);
    await q(`ALTER TABLE funding_transactions ADD CONSTRAINT ftx_type_chk CHECK (type IN ('deposit','withdrawal'))`);
    await q(`ALTER TABLE funding_transactions ADD CONSTRAINT ftx_status_chk CHECK (status IN ('pending','completed','failed'))`);
    await q(`ALTER TABLE funding_transactions ADD CONSTRAINT ftx_amount_pos_chk CHECK (amount > 0)`);
    await q(`ALTER TABLE funding_transactions ADD CONSTRAINT ftx_multiplier_chk CHECK (turnover_multiplier >= 0)`);
    await queryInterface.addIndex('funding_transactions', ['member_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('funding_transactions');
  },
};