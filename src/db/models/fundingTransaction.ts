import { DataTypes, Model, Sequelize } from 'sequelize';

export type FundingStatus = 'pending' | 'completed' | 'failed';
export type FundingType = 'deposit' | 'withdrawal';

export class FundingTransaction extends Model {
  declare id: string;
  declare memberId: string;
  declare walletId: string;
  declare type: FundingType;
  declare status: FundingStatus;
  declare amount: string;
  declare turnoverMultiplier: number;
  declare pspRef: string | null;
  declare pspReportedAmount: string | null;
  declare failureReason: string | null;
}

export function initFundingTransaction(sequelize: Sequelize): void {
  FundingTransaction.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      memberId: { type: DataTypes.UUID, allowNull: false },
      walletId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.STRING(16), allowNull: false },
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      turnoverMultiplier: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      pspRef: { type: DataTypes.STRING, allowNull: true },
      pspReportedAmount: { type: DataTypes.DECIMAL(36, 18), allowNull: true },
      failureReason: { type: DataTypes.STRING, allowNull: true },
    },
    { sequelize, tableName: 'funding_transactions', underscored: true },
  );
}