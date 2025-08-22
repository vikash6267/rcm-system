"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Calendar, Download, FileText } from "lucide-react"

interface ARAgingReportProps {
  onExport?: (data: any) => void
}

export function ARAgingReport({ onExport }: ARAgingReportProps) {
  const [reportData, setReportData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split("T")[0])

  const generateReport = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/reports/ar-aging?date_as_of=${asOfDate}`)
      const data = await response.json()
      if (data.success) {
        setReportData(data.data)
      }
    } catch (error) {
      console.error("Failed to generate A/R aging report:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    generateReport()
  }, [])

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          A/R Aging Report
        </CardTitle>
        <CardDescription>Patient accounts receivable aging analysis</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Report Controls */}
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <Label htmlFor="asOfDate">As of Date</Label>
            <Input id="asOfDate" type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
          </div>
          <Button onClick={generateReport} disabled={loading}>
            <Calendar className="h-4 w-4 mr-2" />
            {loading ? "Generating..." : "Generate Report"}
          </Button>
          {reportData && (
            <Button variant="outline" onClick={() => onExport?.(reportData)}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          )}
        </div>

        {reportData && (
          <>
            {/* Summary Totals */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <div className="text-center p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Total Balance</p>
                <p className="text-lg font-bold">{formatCurrency(reportData.summary.total_balance)}</p>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Current</p>
                <p className="text-lg font-bold">{formatCurrency(reportData.summary.current_0_30)}</p>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">31-60 Days</p>
                <p className="text-lg font-bold">{formatCurrency(reportData.summary.days_31_60)}</p>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">61-90 Days</p>
                <p className="text-lg font-bold">{formatCurrency(reportData.summary.days_61_90)}</p>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">91-120 Days</p>
                <p className="text-lg font-bold">{formatCurrency(reportData.summary.days_91_120)}</p>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">120+ Days</p>
                <p className="text-lg font-bold">{formatCurrency(reportData.summary.days_over_120)}</p>
              </div>
            </div>

            {/* Detailed Report */}
            <div className="space-y-2">
              <h4 className="font-medium">Patient Details</h4>
              <div className="border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-3">Patient</th>
                        <th className="text-left p-3">Contact</th>
                        <th className="text-right p-3">Total</th>
                        <th className="text-right p-3">Current</th>
                        <th className="text-right p-3">31-60</th>
                        <th className="text-right p-3">61-90</th>
                        <th className="text-right p-3">91-120</th>
                        <th className="text-right p-3">120+</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.details.slice(0, 10).map((patient: any, index: number) => (
                        <tr key={index} className="border-t">
                          <td className="p-3">
                            <div>
                              <p className="font-medium">
                                {patient.first_name} {patient.last_name}
                              </p>
                              <p className="text-xs text-muted-foreground">{patient.patient_id}</p>
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="text-xs">
                              <p>{patient.phone}</p>
                              <p>{patient.email}</p>
                            </div>
                          </td>
                          <td className="text-right p-3 font-medium">{formatCurrency(patient.total_balance)}</td>
                          <td className="text-right p-3">{formatCurrency(patient.current_0_30)}</td>
                          <td className="text-right p-3">{formatCurrency(patient.days_31_60)}</td>
                          <td className="text-right p-3">{formatCurrency(patient.days_61_90)}</td>
                          <td className="text-right p-3">{formatCurrency(patient.days_91_120)}</td>
                          <td className="text-right p-3">{formatCurrency(patient.days_over_120)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {reportData.details.length > 10 && (
                <p className="text-sm text-muted-foreground text-center">
                  Showing 10 of {reportData.details.length} patients. Export for full report.
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
