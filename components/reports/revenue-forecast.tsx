"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { TrendingUp, DollarSign, BarChart3 } from "lucide-react"

export function RevenueForecast() {
  const [forecastData, setForecastData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const generateForecast = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/reports/revenue-forecast")
      const data = await response.json()
      if (data.success) {
        setForecastData(data.data)
      }
    } catch (error) {
      console.error("Failed to generate revenue forecast:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    generateForecast()
  }, [])

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Revenue Forecast
        </CardTitle>
        <CardDescription>6-month revenue projection based on historical trends</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={generateForecast} disabled={loading} className="w-full">
          <BarChart3 className="h-4 w-4 mr-2" />
          {loading ? "Generating..." : "Generate Forecast"}
        </Button>

        {forecastData && (
          <>
            {/* Current Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center p-4 bg-muted rounded-lg">
                <DollarSign className="h-6 w-6 mx-auto mb-2 text-primary" />
                <p className="text-sm text-muted-foreground">Pending Revenue</p>
                <p className="text-2xl font-bold">{formatCurrency(forecastData.pending.pending_revenue || 0)}</p>
                <p className="text-xs text-muted-foreground">{forecastData.pending.pending_claims} claims</p>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <TrendingUp className="h-6 w-6 mx-auto mb-2 text-green-600" />
                <p className="text-sm text-muted-foreground">Last Month Revenue</p>
                <p className="text-2xl font-bold">
                  {forecastData.historical[0] ? formatCurrency(forecastData.historical[0].total_revenue) : "$0"}
                </p>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <BarChart3 className="h-6 w-6 mx-auto mb-2 text-blue-600" />
                <p className="text-sm text-muted-foreground">Avg Monthly Revenue</p>
                <p className="text-2xl font-bold">
                  {forecastData.historical.length > 0
                    ? formatCurrency(
                        forecastData.historical.reduce((sum: number, month: any) => sum + month.total_revenue, 0) /
                          forecastData.historical.length,
                      )
                    : "$0"}
                </p>
              </div>
            </div>

            {/* Historical Trends */}
            <div className="space-y-2">
              <h4 className="font-medium">Historical Revenue (Last 12 Months)</h4>
              <div className="space-y-2">
                {forecastData.historical.slice(0, 6).map((month: any, index: number) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <span className="font-medium">{month.month}</span>
                    <div className="text-right">
                      <p className="font-bold">{formatCurrency(month.total_revenue)}</p>
                      <p className="text-xs text-muted-foreground">
                        Insurance: {formatCurrency(month.insurance_revenue)} | Patient:{" "}
                        {formatCurrency(month.patient_revenue)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Forecast */}
            {forecastData.forecast && forecastData.forecast.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium">6-Month Forecast</h4>
                <div className="space-y-2">
                  {forecastData.forecast.map((month: any, index: number) => (
                    <div key={index} className="flex items-center justify-between p-3 border rounded-lg bg-blue-50">
                      <span className="font-medium">{month.month}</span>
                      <div className="text-right">
                        <p className="font-bold">{formatCurrency(month.predicted_revenue)}</p>
                        <p className="text-xs text-muted-foreground">
                          Confidence: {Math.round(month.confidence * 100)}%
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
