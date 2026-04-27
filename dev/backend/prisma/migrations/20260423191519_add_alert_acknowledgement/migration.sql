-- AlterEnum
ALTER TYPE "AlertStatus" ADD VALUE 'acknowledged';

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3);
