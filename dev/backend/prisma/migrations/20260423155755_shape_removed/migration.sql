/*
  Warnings:

  - You are about to drop the `Shape` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Shape" DROP CONSTRAINT "Shape_userId_fkey";

-- DropTable
DROP TABLE "Shape";
