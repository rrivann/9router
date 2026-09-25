import { getConsistentMachineId } from "@/shared/utils/machineId";
import EndpointPageClient from "./endpoint/EndpointPageClient";

export default async function DashboardPage() {
  const machineId = await getConsistentMachineId();
  return <EndpointPageClient machineId={machineId} />;
}
