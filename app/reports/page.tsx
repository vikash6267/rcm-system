"use client"

import { useAuth } from "@/hooks/use-auth"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { BarChart3, FileText, TrendingUp, Users, DollarSign, AlertTriangle } from "lucide-react"
import { ARAgingReport } from "@/components/reports/ar-aging-report"
import { RevenueForecast } from "@/components/reports/revenue-forecast"

export default function ReportsPage() {
  const { user, isAuthenticated, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push("/")
    }
  }, [isAuthenticated, loading, router])

  const handleExportReport = (data: any, reportName: string) => {
    // Convert data to CSV and download
    const csvContent = convertToCSV(data)
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const link = document.createElement("a")
    const url = URL.createObjectURL(blob)
    link.setAttribute("href", url)
    link.setAttribute("download", `${reportName}_${new Date().toISOString().split("T")[0]}.csv`)
    link.style.visibility = "hidden"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const convertToCSV = (data: any) => {
    // Simple CSV conversion - would need more sophisticated handling for complex data
    if (data.details && Array.isArray(data.details)) {
      const headers = Object.keys(data.details[0]).join(",")
      const rows = data.details.map((row: any) => Object.values(row).join(",")).join("\n")
      return `${headers}\n${rows}`
    }
    return JSON.stringify(data, null, 2)
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
            <BarChart3 className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold">Reports & Analytics</h1>
          </div>
          <div className="ml-auto">
            <Button variant="outline" onClick={() => router.push("/dashboard")}>
              Back to Dashboard
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6">
        <Tabs defaultValue="ar-aging" className="space-y-4">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="ar-aging" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              A/R Aging
            </TabsTrigger>
            <TabsTrigger value="revenue-forecast" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Revenue Forecast
            </TabsTrigger>
            <TabsTrigger value="payer-performance" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Payer Performance
            </TabsTrigger>
            <TabsTrigger value="denial-trends" className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Denial Trends
            </TabsTrigger>
            <TabsTrigger value="collections" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Collections
            </TabsTrigger>
            <TabsTrigger value="financial" className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Financial Summary
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ar-aging">
            <ARAgingReport onExport={(data) => handleExportReport(data, "ar-aging-report")} />
          </TabsContent>

          <TabsContent value="revenue-forecast">
            <RevenueForecast />
          </TabsContent>

          <TabsContent value="payer-performance">
            <div className="text-center py-12">
              <BarChart3 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">Payer Performance Report</h3>
              <p className="text-muted-foreground mb-4">
                Analyze payer payment rates, denial rates, and processing times
              </p>
              <Button>Generate Report</Button>
            </div>
          </TabsContent>

          <TabsContent value="denial-trends">
            <div className="text-center py-12">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">Denial Trends Analysis</h3>
              <p className="text-muted-foreground mb-4">Track denial patterns and identify improvement opportunities</p>
              <Button>Generate Report</Button>
            </div>
          </TabsContent>

          <TabsContent value="collections">
            <div className="text-center py-12">
              <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">Collections Performance</h3>
              <p className="text-muted-foreground mb-4">Monitor collection rates and payment plan effectiveness</p>
              <Button>Generate Report</Button>
            </div>
          </TabsContent>

          <TabsContent value="financial">
            <div className="text-center py-12">
              <DollarSign className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">Financial Dashboard</h3>
              <p className="text-muted-foreground mb-4">Comprehensive financial metrics and KPIs</p>
              <Button>Generate Report</Button>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
