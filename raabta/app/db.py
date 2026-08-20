from sqlmodel import SQLModel,Session,create_engine
from dotenv import load_dotenv

load_dotenv()
import os

DATABASE_URL=os.getenv("DATABASE_URL")

engine=create_engine(DATABASE_URL)
def init_db():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session