import { getConsistentMachineId } from "@/shared/utils/machineId";
import EndpointPageClient from "./EndpointPageClient";

export default async function EndpointPage() {
  const machineId = await getConsistentMachineId();
  return <EndpointPageClient machineId={machineId} />;
}
