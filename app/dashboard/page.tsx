"use client"

import { useAuth } from "@/hooks/use-auth"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Activity } from "lucide-react"
import { DashboardStats } from "@/components/dashboard/dashboard-stats"
import { ClaimsOverview } from "@/components/dashboard/claims-overview"
import { PaymentSummary } from "@/components/dashboard/payment-summary"
import { DenialManagement } from "@/components/dashboard/denial-management"
import { CollectionsTracker } from "@/components/dashboard/collections-tracker"
import { RecentActivity } from "@/components/dashboard/recent-activity"

export default function DashboardPage() {
  const { user, isAuthenticated, loading } = useAuth()
  const router = useRouter()
  const [dashboardData, setDashboardData] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push("/")
    }
  }, [isAuthenticated, loading, router])

  useEffect(() => {
    if (isAuthenticated) {
      fetchDashboardData()
    }
  }, [isAuthenticated])

  const fetchDashboardData = async () => {
    try {
      setIsLoading(true)
      // Simulate API calls - replace with actual API endpoints
      const [claimsRes, paymentsRes, denialsRes, collectionsRes] = await Promise.all([
        fetch("/api/claims/stats/overview"),
        fetch("/api/payments/stats/overview"),
        fetch("/api/denials/stats/overview"),
        fetch("/api/collections/stats/overview"),
      ])

      const data = {
        claims: await claimsRes.json(),
        payments: await paymentsRes.json(),
        denials: await denialsRes.json(),
        collections: await collectionsRes.json(),
      }

      setDashboardData(data)
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error)
    } finally {
      setIsLoading(false)
    }
  }

  if (loading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="flex h-16 items-center px-6">
          <div className="flex items-center space-x-4">
            <Activity className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold">RCM Dashboard</h1>
          </div>
          <div className="ml-auto flex items-center space-x-4">
            <Badge variant="outline" className="text-xs">
              {user?.role}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Welcome, {user?.first_name} {user?.last_name}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Add logout functionality
              }}
            >
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6">
        <div className="space-y-6">
          {/* Key Metrics */}
          <DashboardStats isLoading={isLoading} data={dashboardData} />

          {/* Main Dashboard Tabs */}
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="claims">Claims</TabsTrigger>
              <TabsTrigger value="payments">Payments</TabsTrigger>
              <TabsTrigger value="denials">Denials</TabsTrigger>
              <TabsTrigger value="collections">Collections</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <ClaimsOverview isLoading={isLoading} data={dashboardData?.claims} />
                <PaymentSummary isLoading={isLoading} data={dashboardData?.payments} />
                <DenialManagement isLoading={isLoading} data={dashboardData?.denials} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <CollectionsTracker isLoading={isLoading} data={dashboardData?.collections} />
                <RecentActivity isLoading={isLoading} />
              </div>
            </TabsContent>

            <TabsContent value="claims">
              <ClaimsOverview isLoading={isLoading} data={dashboardData?.claims} expanded />
            </TabsContent>

            <TabsContent value="payments">
              <PaymentSummary isLoading={isLoading} data={dashboardData?.payments} expanded />
            </TabsContent>

            <TabsContent value="denials">
              <DenialManagement isLoading={isLoading} data={dashboardData?.denials} expanded />
            </TabsContent>

            <TabsContent value="collections">
              <CollectionsTracker isLoading={isLoading} data={dashboardData?.collections} expanded />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  )
}
