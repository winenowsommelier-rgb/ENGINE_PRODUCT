from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Add CORS middleware to allow requests from Claude and other AI platforms
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://claude.ai", # Claude web interface
        "https://chatgpt.com", # ChatGPT web interface
        "http://localhost:3000", # Local development
        "http://localhost:8501", # Streamlit local
        # "*" # (Optional) Uncomment to allow ALL origins, though less secure
    ],
    allow_credentials=True,
    allow_methods=["*"], # Allows all HTTP methods (GET, POST, etc.)
    allow_headers=["*"], # Allows all headers (including X-API-Key)
)