from sqlmodel import SQLModel,Session,create_engine

DATABASE_URL="postgresql://postgres:080305@localhost:5432/raabtalink"

engine=create_engine(DATABASE_URL)
def init_db():
    SQLModel.metadata.create_all(engine)