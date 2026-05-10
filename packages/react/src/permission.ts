export interface PermissionState {
  readonly status: "deferred"
  readonly permission: string
}

export const usePermission = (permission: string): PermissionState => ({
  status: "deferred",
  permission
})
