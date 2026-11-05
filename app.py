"""Portable Windows GUI for Blackbox Stick Overlay."""
import queue
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog,messagebox,ttk
from overlay_core import make_overlay

class UI:
    def __init__(self):
        self.root=tk.Tk()
        self.root.title("Blackbox Stick Overlay 0.5 - Windows preview")
        self.root.geometry("720x380")
        self.source=tk.StringVar()
        self.folder=tk.StringVar()
        self.fps=tk.StringVar(value="60")
        self.flight=tk.StringVar(value="1")
        self.offset=tk.StringVar(value="0")
        self.duration=tk.StringVar()
        self.queue=queue.Queue()
        body=ttk.Frame(self.root,padding=20)
        body.pack(fill="both",expand=True)
        for row,label,var,cmd in [
            (0,"Blackbox log (.BBL/.BFL)",self.source,self.choose_file),
            (1,"Output directory",self.folder,self.choose_dir)]:
            ttk.Label(body,text=label).grid(row=row,column=0,sticky="w",pady=8)
            ttk.Entry(body,textvariable=var,width=58).grid(row=row,column=1,padx=8)
            ttk.Button(body,text="Browse",command=cmd).grid(row=row,column=2)
        opts=ttk.Frame(body)
        opts.grid(row=2,column=0,columnspan=3,sticky="w",pady=16)
        for col,label,var in [(0,"FPS",self.fps),(1,"Flight",self.flight),
                              (2,"Offset (s)",self.offset),(3,"Duration (s, optional)",self.duration)]:
            ttk.Label(opts,text=label).grid(row=0,column=col*2,padx=(0,4))
            ttk.Entry(opts,textvariable=var,width=8).grid(row=0,column=col*2+1,padx=(0,12))
        self.button=ttk.Button(body,text="Generate transparent PNG overlay",command=self.start)
        self.button.grid(row=3,column=0,columnspan=3,pady=6)
        self.status=tk.Text(body,width=83,height=7,state="disabled")
        self.status.grid(row=4,column=0,columnspan=3,pady=8)
        self.root.after(150,self.poll)
    def choose_file(self):
        value=filedialog.askopenfilename(filetypes=[("Blackbox logs","*.bbl *.bfl"),("Decoded CSV","*.csv")])
        if value:
            self.source.set(value)
            self.folder.set(str(Path(value).parent/(Path(value).stem+"_overlay")))
    def choose_dir(self):
        value=filedialog.askdirectory()
        if value:self.folder.set(value)
    def log(self,txt):
        self.queue.put(str(txt))
    def poll(self):
        while not self.queue.empty():
            msg=self.queue.get_nowait()
            self.status.configure(state="normal")
            self.status.insert("end",msg+"\n")
            self.status.see("end")
            self.status.configure(state="disabled")
        self.root.after(150,self.poll)
    def start(self):
        src=Path(self.source.get())
        if not src.is_file() or not self.folder.get():
            messagebox.showerror("Missing input","Select a Blackbox file and output folder")
            return
        try:
            opts=dict(flight=int(self.flight.get()),fps=float(self.fps.get()),
                      offset=float(self.offset.get()),
                      duration=float(self.duration.get()) if self.duration.get() else None)
        except ValueError:
            messagebox.showerror("Invalid settings","Check FPS, flight, offset and duration")
            return
        self.button.configure(state="disabled")
        self.log("Reading Blackbox log...")
        def run():
            try:make_overlay(src,self.folder.get(),progress=self.log,**opts)
            except Exception as e:self.log("ERROR: "+str(e))
            finally:self.root.after(0,lambda:self.button.configure(state="normal"))
        threading.Thread(target=run,daemon=True).start()
    def main(self):self.root.mainloop()

if __name__=="__main__":UI().main()
