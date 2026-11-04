export type GoalStatus = "active" | "paused" | "achieved" | "abandoned"

export type GoalDetails = {
  label: string
  targetAmount: number
  targetMonth: string // YYYY-MM
  startMonth: string // YYYY-MM
  initialSavedAmount: number
}

export type GoalPatch = Partial<{
  label: string
  targetAmount: number
  targetMonth: string
  status: GoalStatus
}>

export type GoalState = Omit<GoalDetails, "initialSavedAmount"> & {
  id: number
  savedAmount: number
  status: GoalStatus
  version: number
}
