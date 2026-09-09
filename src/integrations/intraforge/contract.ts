import type { Services } from "../../services/contracts";
/** Supplied by the main platform; deliberately no speculative endpoints. */
export interface IntraForgeContext {
  appInstanceId: string;
  permissionProvider: {
    can(action: string, resource: string): Promise<boolean>;
  };
}
export type IntraForgeAdapterFactory = (
  context: IntraForgeContext,
) => Promise<Services>;
