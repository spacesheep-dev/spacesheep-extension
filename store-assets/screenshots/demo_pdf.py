from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from pathlib import Path
out=Path(__file__).resolve().parents[2]/'dist/store-screenshots'
out.mkdir(parents=True,exist_ok=True)
c=canvas.Canvas(str(out/'field-guide.pdf'),pagesize=(840,640))
c.setFillColor(HexColor('#f5f1e7'));c.rect(0,0,840,640,fill=1,stroke=0)
c.setFillColor(HexColor('#244c40'));c.setFont('Helvetica-Bold',15);c.drawString(54,582,'FIELDNOTES   /   A GUIDE TO GETTING OUTSIDE')
c.setFont('Times-Roman',60);c.drawString(54,490,'A little more outside.')
c.setFont('Helvetica',18);c.drawString(56,450,'Small adventures. Room to breathe. A weekend well spent.')
for x,n,t in [(54,'01','Take the scenic route'),(306,'02','Pack the essentials'),(558,'03','Leave room to wander')]:
 c.setFillColor(HexColor('#dde4d3'));c.roundRect(x,205,228,184,12,fill=1,stroke=0)
 c.setFillColor(HexColor('#244c40'));c.setFont('Times-Roman',52);c.drawString(x+20,320,n)
 c.setFont('Helvetica-Bold',15);c.drawString(x+20,250,t)
c.setFont('Helvetica',16);c.drawString(54,145,'Make a plan that leaves space for the unexpected.')
c.setFont('Helvetica',12);c.drawString(54,55,'THE WEEKEND EDITION                                      DEMO DOCUMENT                                      01')
c.save()
