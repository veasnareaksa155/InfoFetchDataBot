# Boss Report Format Rule

## Khmer Structured Remork Block Sales Summary Report Format for Boss ("មេ")

Whenever the user asks for a Boss Report template, summary report for Admin to send to Boss ("មេ"), or when generating grand multi-group summary reports, ALWAYS format the report strictly using the following Khmer Block structure:

```text
បាទគោរពមេ🙏🏻🙏🏻🙏🏻
ទិន្នន័យលក់({totalGroups}ក្រុម/រ៉ឺម៉ក)
ថ្ងៃទី{reportDate}

=>រ៉ឺម៉កទី1(បងរិត 9 ទីតាំង= 12នាក់)
- ទីតាំងទី1 លក់បាន= 45600៛
- ទីតាំងទី2 លក់បាន= 80000៛
💰 សរុបរ៉ឺម៉កទី1= 125,600៛

=>រ៉ឺម៉កទី2(ពូរួ 1 ទីតាំង= 10នាក់)
- ទីតាំងទី1 លក់បាន= 128000៛
💰 សរុបរ៉ឺម៉កទី2= 128,000៛

សរុបចំនួនមនុស្ស={grandSellerCount} នាក់
សរុបលក់បាន= {grandTotalRevenue}
គោរពអរគុណមេ🙏🏻🙏🏻🙏🏻
```

### Key Requirements:
1. **Block Header per Remork/Team**: `=>` + `Remork Name` + `(` + `Manager Name` + ` ` + `Location Count` + ` ទីតាំង= ` + `Seller Count` + `នាក់)`.
   - Example header: `=>រ៉ឺម៉កទី2(ពូរួ 1 ទីតាំង= 10នាក់)`.
2. **Sales per Location sub-lines**: `- ទីតាំងទី1 លក់បាន= 128000៛`.
3. **Remork Subtotal line**: `💰 សរុបរ៉ឺម៉កទី2= 128,000៛`.
4. **Overall Grand Total Footer**:
   - `សរុបចំនួនមនុស្ស= 22 នាក់`
   - `សរុបលក់បាន= 253,600៛`
   - `គោរពអរគុណមេ🙏🏻🙏🏻🙏🏻`
