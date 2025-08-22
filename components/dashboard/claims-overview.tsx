import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FileText, CheckCircle, Clock, XCircle, AlertCircle } from "lucide-react"

interface ClaimsOverviewProps {
  isLoading: boolean
  data: any
  expanded?: boolean
}

export function ClaimsOverview({ isLoading, data, expanded = false }: ClaimsOverviewProps) {
  const claimStatuses = [
    {
      status: "Submitted",
      count: data?.overview?.submitted_claims || 0,
      icon: Clock,
      color: "bg-blue-500",
    },
    {
      status: "Accepted",
      count: data?.overview?.accepted_claims || 0,
      icon: CheckCircle,
      color: "bg-green-500",
    },
    {
      status: "Denied",
      count: data?.overview?.denied_claims || 0,
      icon: XCircle,
      color: "bg-red-500",
    },
    {
      status: "Pending",
      count: data?.overview?.pending_claims || 0,
      icon: AlertCircle,
      color: "bg-yellow-500",
    },
  ]

  const recentClaims = [
    {
      id: "CLM001234",
      patient: "John Smith",
      amount: "$1,250.00",
      status: "Submitted",
      date: "2024-01-15",
    },
    {
      id: "CLM001235",
      patient: "Sarah Johnson",
      amount: "$850.00",
      status: "Accepted",
      date: "2024-01-14",
    },
    {
      id: "CLM001236",
      patient: "Mike Davis",
      amount: "$2,100.00",
      status: "Denied",
      date: "2024-01-13",
    },
  ]

  return (
    <Card className={expanded ? "col-span-full" : ""}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Claims Overview
        </CardTitle>
        <CardDescription>Current status of submitted claims</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Summary */}
        <div className="grid grid-cols-2 gap-4">
          {claimStatuses.map((status, index) => {
            const Icon = status.icon
            return (
              <div key={index} className="flex items-center space-x-3">
                <div className={`p-2 rounded-full ${status.color}`}>
                  <Icon className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium">{status.status}</p>
                  <p className="text-2xl font-bold">{isLoading ? "..." : status.count}</p>
                </div>
              </div>
            )
          })}
        </div>

        {expanded && (
          <>
            {/* Recent Claims Table */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Recent Claims</h4>
              <div className="space-y-2">
                {recentClaims.map((claim, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div>
                        <p className="font-medium">{claim.id}</p>
                        <p className="text-sm text-muted-foreground">{claim.patient}</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className="font-medium">{claim.amount}</span>
                      <Badge
                        variant={
                          claim.status === "Accepted"
                            ? "default"
                            : claim.status === "Denied"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {claim.status}
                      </Badge>
                      <span className="text-sm text-muted-foreground">{claim.date}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <Button variant="outline" className="w-full bg-transparent">
          View All Claims
        </Button>
      </CardContent>
    </Card>
  )
}
