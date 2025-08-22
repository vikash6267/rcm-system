import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Activity, FileText, DollarSign, AlertTriangle, CheckCircle } from "lucide-react"

interface RecentActivityProps {
  isLoading: boolean
}

export function RecentActivity({ isLoading }: RecentActivityProps) {
  const activities = [
    {
      type: "claim_submitted",
      description: "Claim CLM001234 submitted for John Smith",
      time: "2 minutes ago",
      icon: FileText,
      color: "text-blue-600",
    },
    {
      type: "payment_received",
      description: "Payment of $1,250.00 received for CLM001230",
      time: "15 minutes ago",
      icon: DollarSign,
      color: "text-green-600",
    },
    {
      type: "denial_resolved",
      description: "Denial DN001 resolved - claim resubmitted",
      time: "1 hour ago",
      icon: CheckCircle,
      color: "text-green-600",
    },
    {
      type: "new_denial",
      description: "New denial DN004 for CLM001235 - Missing Auth",
      time: "2 hours ago",
      icon: AlertTriangle,
      color: "text-red-600",
    },
    {
      type: "era_processed",
      description: "ERA file processed - 25 claims updated",
      time: "3 hours ago",
      icon: Activity,
      color: "text-purple-600",
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Recent Activity
        </CardTitle>
        <CardDescription>Latest system activities and updates</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities.map((activity, index) => {
            const Icon = activity.icon
            return (
              <div key={index} className="flex items-start space-x-3">
                <Icon className={`h-5 w-5 mt-0.5 ${activity.color}`} />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium leading-none">{activity.description}</p>
                  <p className="text-xs text-muted-foreground">{activity.time}</p>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
