import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Users, Calendar, TrendingDown } from "lucide-react"

interface CollectionsTrackerProps {
  isLoading: boolean
  data: any
  expanded?: boolean
}

export function CollectionsTracker({ isLoading, data, expanded = false }: CollectionsTrackerProps) {
  const agingBuckets = [
    {
      range: "0-30 days",
      amount: data?.collections?.balance_0_30 || 0,
      color: "text-green-600",
    },
    {
      range: "31-60 days",
      amount: data?.collections?.balance_31_60 || 0,
      color: "text-yellow-600",
    },
    {
      range: "61-90 days",
      amount: data?.collections?.balance_61_90 || 0,
      color: "text-orange-600",
    },
    {
      range: "90+ days",
      amount: data?.collections?.balance_over_90 || 0,
      color: "text-red-600",
    },
  ]

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  return (
    <Card className={expanded ? "col-span-full" : ""}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Collections Tracker
        </CardTitle>
        <CardDescription>Patient balance aging and collection status</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Total Outstanding */}
        <div className="text-center p-4 bg-muted rounded-lg">
          <p className="text-sm text-muted-foreground">Total Outstanding</p>
          <p className="text-3xl font-bold text-primary">
            {isLoading ? "..." : formatCurrency(data?.collections?.total_balance || 0)}
          </p>
        </div>

        {/* Aging Buckets */}
        <div className="space-y-3">
          {agingBuckets.map((bucket, index) => (
            <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
              <span className="font-medium">{bucket.range}</span>
              <span className={`font-bold ${bucket.color}`}>{isLoading ? "..." : formatCurrency(bucket.amount)}</span>
            </div>
          ))}
        </div>

        {expanded && (
          <div className="space-y-4">
            {/* Collection Performance Metrics */}
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 border rounded-lg">
                <Calendar className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
                <p className="text-lg font-bold">{data?.payment_plans?.active_plans || 0}</p>
                <p className="text-sm text-muted-foreground">Active Payment Plans</p>
              </div>
              <div className="text-center p-3 border rounded-lg">
                <TrendingDown className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
                <p className="text-lg font-bold">12.5%</p>
                <p className="text-sm text-muted-foreground">Collection Rate</p>
              </div>
            </div>
          </div>
        )}

        <Button variant="outline" className="w-full bg-transparent">
          View Collections
        </Button>
      </CardContent>
    </Card>
  )
}
