from engagement_analysis import run_analysis


if __name__ == "__main__":
    result = run_analysis()
    print(f"Отчёт: {result['report_path']}")
    print(f"Ноутбук можно открыть после выполнения: {result['notebook_path']}")
