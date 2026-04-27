import cors from "cors";
import * as dotenv from "dotenv";
import express from "express";
import { startMonitoringRunQueue } from "./lib/monitoringRunQueue.js";
import { alertsRouter } from "./routes/alerts.js";
import { aoiRouter } from "./routes/aoi.js";
import { authRouter } from "./routes/auth.js";
import { monitoringRouter } from "./routes/monitoring.js";
import { notificationsRouter } from "./routes/notifications.js";
import { reportsRouter } from "./routes/reports.js";
import { thresholdProfilesRouter } from "./routes/thresholdProfiles.js";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

app.get("/health", (_req, res) => {
	res.status(200).json({ status: "ok" });
});

app.use("/bhoomi", authRouter);
app.use("/bhoomi", aoiRouter);
app.use("/bhoomi", monitoringRouter);
app.use("/bhoomi", alertsRouter);
app.use("/bhoomi", reportsRouter);
app.use("/bhoomi", thresholdProfilesRouter);
app.use("/bhoomi", notificationsRouter);

startMonitoringRunQueue();

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
	console.log(`backend listening on ${port}`);
});