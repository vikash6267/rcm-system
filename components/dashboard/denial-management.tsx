import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Clock, CheckCircle } from "lucide-react"

interface DenialManagementProps {
  isLoading: boolean
  data: any
  expanded?: boolean
}

export function DenialManagement({ isLoading, data, expanded = false }: DenialManagementProps) {
  const denialStats = [
    {
      status: "Open",
      count: data?.overview?.open_denials || 0,
      icon: AlertTriangle,
      color: "text-red-600",
    },
    {
      status: "In Progress",
      count: data?.overview?.in_progress_denials || 0,
      icon: Clock,
      color: "text-yellow-600",
    },
    {
      status: "Resolved",
      count: data?.overview?.resolved_denials || 0,
      icon: CheckCircle,
      color: "text-green-600",
    },
  ]

  const recentDenials = [
    {
      id: "DN001",
      claim: "CLM001234",
      reason: "Missing Authorization",
      priority: "High",
      daysOpen: 5,
    },
    {
      id: "DN002",
      claim: "CLM001235",
      reason: "Incorrect Coding",
      priority: "Medium",
      daysOpen: 12,
    },
    {
      id: "DN003",
      claim: "CLM001236",
      reason: "Duplicate Claim",
      priority: "Low",
      daysOpen: 3,
    },
  ]

  return (
    <Card className={expanded ? "col-span-full" : ""}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Denial Management
        </CardTitle>
        <CardDescription>Track and resolve claim denials</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Denial Stats */}
        <div className="grid grid-cols-3 gap-4">
          {denialStats.map((stat, index) => {
            const Icon = stat.icon
            return (
              <div key={index} className="text-center">
                <Icon className={`h-6 w-6 mx-auto mb-2 ${stat.color}`} />
                <p className="text-2xl font-bold">{isLoading ? "..." : stat.count}</p>
                <p className="text-sm text-muted-foreground">{stat.status}</p>
              </div>
            )
          })}
        </div>

        {expanded && (
          <>
            {/* Recent Denials */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Recent Denials</h4>
              <div className="space-y-2">
                {recentDenials.map((denial, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="font-medium">{denial.claim}</p>
                      <p className="text-sm text-muted-foreground">{denial.reason}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge
                        variant={
                          denial.priority === "High"
                            ? "destructive"
                            : denial.priority === "Medium"
                              ? "default"
                              : "secondary"
                        }
                      >
                        {denial.priority}
                      </Badge>
                      <span className="text-sm text-muted-foreground">{denial.daysOpen} days</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <Button variant="outline" className="w-full bg-transparent">
          Manage Denials
        </Button>
      </CardContent>
    </Card>
  )
}
