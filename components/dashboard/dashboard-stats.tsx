"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DollarSign, FileText, AlertTriangle, Users, TrendingUp, Clock } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

interface DashboardStatsProps {
  isLoading: boolean
  data: any
}

export function DashboardStats({ isLoading, data }: DashboardStatsProps) {
  const router = useRouter()

  const stats = [
    {
      title: "Total Revenue",
      value: data?.payments?.overview?.total_amount || 0,
      change: "+12.5%",
      icon: DollarSign,
      format: "currency",
    },
    {
      title: "Active Claims",
      value: data?.claims?.overview?.total_claims || 0,
      change: "+2.1%",
      icon: FileText,
      format: "number",
    },
    {
      title: "Open Denials",
      value: data?.denials?.overview?.open_denials || 0,
      change: "-5.2%",
      icon: AlertTriangle,
      format: "number",
    },
    {
      title: "Collections",
      value: data?.collections?.collections?.total_balance || 0,
      change: "+8.3%",
      icon: Users,
      format: "currency",
    },
    {
      title: "Payment Rate",
      value: "94.2%",
      change: "+1.8%",
      icon: TrendingUp,
      format: "percentage",
    },
    {
      title: "Avg Days to Pay",
      value: "28",
      change: "-3 days",
      icon: Clock,
      format: "days",
    },
  ]

  const formatValue = (value: any, format: string) => {
    if (isLoading) return "..."

    switch (format) {
      case "currency":
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(value)
      case "number":
        return new Intl.NumberFormat("en-US").format(value)
      case "percentage":
        return value
      case "days":
        return `${value} days`
      default:
        return value
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Key Metrics</h2>
        <Button variant="outline" onClick={() => router.push("/reports")}>
          View Reports
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {stats.map((stat, index) => {
          const Icon = stat.icon
          return (
            <Card key={index}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatValue(stat.value, stat.format)}</div>
                <p className="text-xs text-muted-foreground">
                  <span
                    className={
                      stat.change.startsWith("+") ? "text-green-600" : stat.change.startsWith("-") ? "text-red-600" : ""
                    }
                  >
                    {stat.change}
                  </span>{" "}
                  from last month
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
