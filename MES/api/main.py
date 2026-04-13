from datetime import datetime

from fastapi import FastAPI


app = FastAPI(title="MES Pulse API")


@app.post("/pulse")
def pulse(data: dict):
    print("Impuls:", data, datetime.now())
    return {"status": "ok"}
