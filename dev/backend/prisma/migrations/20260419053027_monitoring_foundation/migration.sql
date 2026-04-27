-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('active', 'resolved');

-- AlterTable
ALTER TABLE "Shape" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "Aoi" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "geometry" JSONB NOT NULL,
    "sourceType" TEXT,
    "metadata" JSONB,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Aoi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AoiVersion" (
    "id" TEXT NOT NULL,
    "aoiId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "geometry" JSONB NOT NULL,
    "sourceType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AoiVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThresholdProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'strict',
    "config" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThresholdProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "aoiId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "runDate" TIMESTAMP(3) NOT NULL,
    "baselineMode" TEXT,
    "baselineYears" INTEGER,
    "baselineLagYears" INTEGER,
    "thresholdProfileId" TEXT,
    "configSnapshot" JSONB,
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreatMetric" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "threatType" TEXT NOT NULL,
    "rawAreaKm2" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "filteredAreaKm2" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "percentOfAoi" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "triggered" BOOLEAN NOT NULL DEFAULT false,
    "severity" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThreatMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "aoiId" TEXT NOT NULL,
    "runId" TEXT,
    "threatType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "areaKm2" DOUBLE PRECISION NOT NULL,
    "percentOfAoi" DOUBLE PRECISION NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'active',
    "message" TEXT,
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "details" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "aoiId" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "configSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Aoi_userId_createdAt_idx" ON "Aoi"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Aoi_isDeleted_updatedAt_idx" ON "Aoi"("isDeleted", "updatedAt");

-- CreateIndex
CREATE INDEX "AoiVersion_aoiId_createdAt_idx" ON "AoiVersion"("aoiId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AoiVersion_aoiId_version_key" ON "AoiVersion"("aoiId", "version");

-- CreateIndex
CREATE INDEX "ThresholdProfile_userId_isDefault_idx" ON "ThresholdProfile"("userId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "ThresholdProfile_userId_name_key" ON "ThresholdProfile"("userId", "name");

-- CreateIndex
CREATE INDEX "MonitoringRun_aoiId_status_createdAt_idx" ON "MonitoringRun"("aoiId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MonitoringRun_userId_createdAt_idx" ON "MonitoringRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ThreatMetric_runId_threatType_idx" ON "ThreatMetric"("runId", "threatType");

-- CreateIndex
CREATE INDEX "Alert_aoiId_status_severity_createdAt_idx" ON "Alert"("aoiId", "status", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_userId_createdAt_idx" ON "Alert"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Report_runId_key" ON "Report"("runId");

-- CreateIndex
CREATE INDEX "Report_generatedAt_idx" ON "Report"("generatedAt");

-- CreateIndex
CREATE INDEX "MonitoringSchedule_nextRunAt_isActive_idx" ON "MonitoringSchedule"("nextRunAt", "isActive");

-- CreateIndex
CREATE INDEX "MonitoringSchedule_aoiId_isActive_idx" ON "MonitoringSchedule"("aoiId", "isActive");

-- AddForeignKey
ALTER TABLE "Aoi" ADD CONSTRAINT "Aoi_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AoiVersion" ADD CONSTRAINT "AoiVersion_aoiId_fkey" FOREIGN KEY ("aoiId") REFERENCES "Aoi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThresholdProfile" ADD CONSTRAINT "ThresholdProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringRun" ADD CONSTRAINT "MonitoringRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringRun" ADD CONSTRAINT "MonitoringRun_aoiId_fkey" FOREIGN KEY ("aoiId") REFERENCES "Aoi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringRun" ADD CONSTRAINT "MonitoringRun_thresholdProfileId_fkey" FOREIGN KEY ("thresholdProfileId") REFERENCES "ThresholdProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreatMetric" ADD CONSTRAINT "ThreatMetric_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MonitoringRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_aoiId_fkey" FOREIGN KEY ("aoiId") REFERENCES "Aoi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MonitoringRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MonitoringRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringSchedule" ADD CONSTRAINT "MonitoringSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringSchedule" ADD CONSTRAINT "MonitoringSchedule_aoiId_fkey" FOREIGN KEY ("aoiId") REFERENCES "Aoi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
