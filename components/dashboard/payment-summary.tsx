import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DollarSign, TrendingUp, CreditCard, Banknote } from "lucide-react"

interface PaymentSummaryProps {
  isLoading: boolean
  data: any
  expanded?: boolean
}

export function PaymentSummary({ isLoading, data, expanded = false }: PaymentSummaryProps) {
  const paymentTypes = [
    {
      type: "Insurance",
      amount: data?.overview?.insurance_payments || 0,
      icon: CreditCard,
      color: "text-blue-600",
    },
    {
      type: "Patient",
      amount: data?.overview?.patient_payments || 0,
      icon: Banknote,
      color: "text-green-600",
    },
    {
      type: "ERA",
      amount: data?.overview?.era_payments || 0,
      icon: TrendingUp,
      color: "text-purple-600",
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
          <DollarSign className="h-5 w-5" />
          Payment Summary
        </CardTitle>
        <CardDescription>Revenue breakdown by payment type</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Total Revenue */}
        <div className="text-center p-4 bg-muted rounded-lg">
          <p className="text-sm text-muted-foreground">Total Revenue (This Month)</p>
          <p className="text-3xl font-bold text-primary">
            {isLoading ? "..." : formatCurrency(data?.overview?.total_amount || 0)}
          </p>
        </div>

        {/* Payment Types */}
        <div className="space-y-3">
          {paymentTypes.map((payment, index) => {
            const Icon = payment.icon
            return (
              <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center space-x-3">
                  <Icon className={`h-5 w-5 ${payment.color}`} />
                  <span className="font-medium">{payment.type}</span>
                </div>
                <span className="font-bold">{isLoading ? "..." : formatCurrency(payment.amount)}</span>
              </div>
            )
          })}
        </div>

        {expanded && (
          <div className="space-y-4">
            {/* Payment Trends Chart Placeholder */}
            <div className="h-64 bg-muted rounded-lg flex items-center justify-center">
              <p className="text-muted-foreground">Payment Trends Chart</p>
            </div>
          </div>
        )}

        <Button variant="outline" className="w-full bg-transparent">
          View Payment Details
        </Button>
      </CardContent>
    </Card>
  )
}
